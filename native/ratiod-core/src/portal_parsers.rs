//! Portal marks/profile/timetable behavior adapted from ratio-d.
use crate::{
    error::{CoreError, ErrorCode, Result},
    models::*,
    parsers::{cells, select, text},
};
use regex::Regex;
use scraper::Html;
use std::collections::{BTreeMap, BTreeSet};

pub(crate) struct Subject {
    pub marks: Marks,
    pub id: Option<String>,
    pub status: String,
}
pub(crate) fn marks_main(html: &str) -> Result<Vec<Subject>> {
    let doc = Html::parse_document(html);
    let code = Regex::new(r"^[A-Z0-9]{6,12}$").unwrap();
    let onclick=Regex::new(r#"funViewComponentWiseMarks\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*(\d+)\s*\)"#).unwrap();
    if doc.select(&select("table")).next().is_none() {
        return Err(CoreError::new(ErrorCode::ParserFailure));
    }
    let mut result = Vec::new();
    for row in doc.select(&select("table tr")) {
        let c = cells(row);
        if c.len() < 3 || !code.is_match(&c[0]) {
            continue;
        }
        let totals = c[2]
            .split_once('/')
            .and_then(|(a, b)| Some((a.trim().parse::<f64>().ok()?, b.trim().parse::<f64>().ok()?)))
            .filter(|(a, b)| a.is_finite() && b.is_finite());
        let capture = row
            .select(&select("button[onclick], a[onclick]"))
            .next()
            .and_then(|n| n.value().attr("onclick"))
            .and_then(|s| onclick.captures(s));
        result.push(Subject {
            marks: Marks {
                course_code: c[0].clone(),
                title: Some(c[1].clone()),
                kind: "Internal".into(),
                performance: if totals.is_some() {
                    c[2].clone()
                } else {
                    "N/A".into()
                },
                assessments: vec![],
                total_got: totals.map(|v| v.0),
                total_max: totals.map(|v| v.1),
            },
            id: capture.as_ref().map(|c| c[1].into()),
            status: capture
                .as_ref()
                .map(|c| c[4].into())
                .unwrap_or_else(|| "2".into()),
        });
    }
    if result.is_empty() && !crate::parsers::recognized_empty_marks(&doc) {
        return Err(CoreError::new(ErrorCode::ParserFailure));
    }
    Ok(result)
}
pub(crate) fn marks_inner(html: &str) -> Result<Vec<Assessment>> {
    let doc = Html::parse_document(html);
    if doc.select(&select("table")).next().is_none() {
        return Err(CoreError::new(ErrorCode::ParserFailure));
    }
    let result: Vec<_> = doc
        .select(&select("table tbody tr"))
        .filter_map(|row| {
            let c = cells(row);
            if c.len() < 3 {
                return None;
            }
            let (a, b) = c[2].split_once('/').unwrap_or(("0", "0"));
            Some(Assessment {
                title: c[1].clone(),
                marks: a.trim().into(),
                total: b.trim().into(),
                date: Some(c[0].clone()),
            })
        })
        .collect();
    let empty_components = doc.select(&select("table")).any(|table| {
        let content = text(table).to_lowercase();
        ["no records", "no data", "no marks"]
            .iter()
            .any(|m| content.contains(m))
            || table.select(&select("tr")).next().is_some_and(|row| {
                let header = text(row).to_lowercase();
                header.contains("component") && header.contains("mark")
            })
    });
    if result.is_empty() && !empty_components {
        return Err(CoreError::new(ErrorCode::ParserFailure));
    }
    Ok(result)
}
pub fn profile(html: &str) -> Result<Profile> {
    let doc = Html::parse_document(html);
    let mut profile = Profile::default();
    let mut recognized = false;
    for row in doc.select(&select("table tr")) {
        let c = cells(row);
        if c.len() < 2 {
            continue;
        }
        let label = c[0].to_lowercase();
        let value = c[1].clone();
        if label.contains("student name") {
            profile.name = value;
            recognized = true;
        } else if label.contains("register no") {
            profile.reg_no = value;
            recognized = true;
        } else if label.contains("institution") || label.contains("department") {
            profile.dept = value;
        } else if label.contains("program") {
            profile.program = value;
        } else if label.contains("batch") {
            profile.batch = value;
        } else if label.contains("semester") {
            profile.semester = value;
        } else if label.contains("section") {
            profile.section = value;
        } else if label.contains("mobile") {
            profile.mobile = value;
        }
    }
    if recognized {
        Ok(profile)
    } else {
        Err(CoreError::new(ErrorCode::ParserFailure))
    }
}

struct Grid {
    rows: BTreeMap<String, Vec<String>>,
    times: Vec<String>,
    course_hits: usize,
    slot_hits: usize,
}
fn tokens(slot: &str) -> BTreeSet<String> {
    slot.split([',', '/'])
        .map(normalize)
        .filter(|s| !s.is_empty())
        .collect()
}
fn normalize(value: &str) -> String {
    value.split_whitespace().collect::<String>().to_uppercase()
}
pub fn timetable(html: &str) -> Result<TimetableData> {
    let doc = Html::parse_document(html);
    let mut courses = CourseMap::new();
    let mut variants: BTreeMap<String, Vec<Course>> = BTreeMap::new();
    let room_split = Regex::new(r"(?i)[,/]|\s+(?:Drafting|Lab|Room|Hall)").unwrap();
    let abbr = Regex::new(r"\(([^)]+)\)").unwrap();
    let lab = Regex::new(r"(?i)\b(lab|practical)\b").unwrap();
    for table in doc.select(&select("table")) {
        let headers: Vec<_> = table
            .select(&select("th"))
            .map(|h| text(h).to_lowercase())
            .collect();
        if !headers.iter().any(|h| h.contains("course code"))
            || !headers.iter().any(|h| h.contains("faculty"))
        {
            continue;
        }
        for row in table.select(&select("tr")) {
            let c = cells(row);
            if c.len() < 5 || row.select(&select("td")).next().is_none() {
                continue;
            }
            let building = c.get(5).cloned().unwrap_or_default();
            let floor = c.get(6).cloned().unwrap_or_default();
            let raw_room = c.get(7).cloned().unwrap_or_default();
            let room_name = room_split
                .split(&raw_room)
                .next()
                .unwrap_or("")
                .trim()
                .to_owned();
            let building_abbr = abbr
                .captures(&building)
                .map(|m| m[1].trim().to_uppercase())
                .unwrap_or_else(|| {
                    building
                        .split([' ', '-'])
                        .filter_map(|w| w.chars().next().filter(|c| c.is_alphanumeric()))
                        .collect::<String>()
                        .to_uppercase()
                });
            let room = if !room_name.is_empty() {
                if building_abbr.is_empty() || room_name.to_uppercase().starts_with(&building_abbr)
                {
                    room_name.clone()
                } else {
                    format!("{building_abbr} {room_name}")
                }
            } else if !building_abbr.is_empty() {
                building_abbr
            } else {
                "TBA".into()
            };
            let kind = if lab.is_match(&c[1])
                || c[3]
                    .split(',')
                    .any(|s| s.trim().to_uppercase().starts_with('P'))
            {
                "Practical"
            } else {
                "Theory"
            };
            let course = Course {
                code: c[0].clone(),
                name: c[1].clone(),
                credits: c[2].clone(),
                kind: kind.into(),
                raw_type: kind.into(),
                faculty: if c[4].is_empty() {
                    "TBA".into()
                } else {
                    c[4].clone()
                },
                room,
                slot: c[3].clone(),
                title: Some(c[1].clone()),
                building: Some(building),
                floor: Some(floor),
                room_name: Some(room_name),
            };
            variants
                .entry(c[0].clone())
                .or_default()
                .push(course.clone());
            courses
                .entry(c[0].clone())
                .and_modify(|existing: &mut Course| {
                    if !course.slot.is_empty() && !existing.slot.contains(&course.slot) {
                        existing.slot.push_str(&format!(", {}", course.slot));
                    }
                    if existing.room == "TBA" && course.room != "TBA" {
                        existing.room = course.room.clone();
                    }
                })
                .or_insert(course);
        }
    }
    let known: BTreeSet<_> = variants
        .values()
        .flatten()
        .flat_map(|c| tokens(&c.slot))
        .collect();
    let day = Regex::new(r"(?i)Day\s*(\d+)").unwrap();
    let time = Regex::new(r"(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})").unwrap();
    let mut grids = Vec::new();
    for table in doc.select(&select("table")) {
        let mut rows = BTreeMap::new();
        for row in table.select(&select("tr")) {
            let c = cells(row);
            if c.is_empty() {
                continue;
            }
            if let Some(m) = day.captures(&c[0]) {
                rows.insert(format!("Day {}", &m[1]), c[1..].to_vec());
            }
        }
        if rows.is_empty() {
            continue;
        }
        let times = table
            .select(&select("thead tr"))
            .map(|r| {
                cells(r)
                    .iter()
                    .filter_map(|s| time.captures(s).map(|m| format!("{} - {}", &m[1], &m[2])))
                    .collect::<Vec<_>>()
            })
            .find(|v| !v.is_empty())
            .unwrap_or_default();
        let course_hits = rows
            .values()
            .flatten()
            .filter(|s| variants.contains_key(*s))
            .count();
        let slot_hits = rows
            .values()
            .flatten()
            .filter(|s| known.contains(&normalize(s)))
            .count();
        grids.push(Grid {
            rows,
            times,
            course_hits,
            slot_hits,
        });
    }
    let mut schedule = Schedule::new();
    // max_by_key uses the last tie; Python max picks the first.
    let Some(index) = grids
        .iter()
        .enumerate()
        .max_by_key(|(i, g)| (g.course_hits, std::cmp::Reverse(*i)))
        .map(|(i, _)| i)
    else {
        return Err(CoreError::new(ErrorCode::ParserFailure));
    };
    let grid = &grids[index];
    if grid.times.is_empty() {
        return Err(CoreError::new(ErrorCode::ParserFailure));
    }
    let slot_grid = grids
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != index)
        .max_by_key(|(i, g)| (g.slot_hits, std::cmp::Reverse(*i)))
        .map(|(_, g)| g)
        .filter(|g| g.slot_hits > 0);
    for (day, codes) in &grid.rows {
        let entries = schedule.entry(day.clone()).or_default();
        for (i, (code, time)) in codes.iter().zip(&grid.times).enumerate() {
            if code.is_empty() || code == "-" || code == "--" {
                continue;
            }
            let actual = slot_grid.and_then(|g| {
                let cells = g.rows.get(day)?;
                if g.times.is_empty() {
                    cells.get(i)
                } else {
                    g.times
                        .iter()
                        .position(|t| normalize(t) == normalize(time))
                        .and_then(|n| cells.get(n))
                }
            });
            let mut start = i;
            while start > 0 && codes[start - 1] == *code {
                start -= 1;
            }
            let mut end = i + 1;
            while end < codes.len() && codes[end] == *code {
                end += 1;
            }
            let count = end - start;
            let chosen = variants
                .get(code)
                .and_then(|choices| {
                    if let Some(actual) = actual
                        && let Some(exact) = choices
                            .iter()
                            .find(|c| tokens(&c.slot).contains(&normalize(actual)))
                    {
                        return Some(exact);
                    }
                    if slot_grid.is_some() {
                        choices
                            .iter()
                            .find(|c| c.kind == "Theory")
                            .or(choices.first())
                    } else {
                        choices.iter().min_by_key(|c| {
                            (
                                c.slot
                                    .split(',')
                                    .filter(|s| !s.trim().is_empty())
                                    .count()
                                    .abs_diff(count),
                                c.kind == "Practical",
                            )
                        })
                    }
                })
                .or_else(|| courses.get(code));
            let fallback = Course {
                code: code.clone(),
                name: code.clone(),
                credits: String::new(),
                kind: "Theory".into(),
                raw_type: "Theory".into(),
                faculty: "TBA".into(),
                room: "TBA".into(),
                slot: String::new(),
                title: Some(code.clone()),
                building: None,
                floor: None,
                room_name: None,
            };
            entries.insert(
                time.clone(),
                ScheduleSlot::from_course(chosen.unwrap_or(&fallback), time.clone(), true),
            );
        }
    }
    Ok(TimetableData { profile: None, schedule, courses })
}
