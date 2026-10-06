//! Academia decoding and parsers adapted from the active Python implementation.
use crate::{
    error::{CoreError, ErrorCode, Result},
    models::*,
    parsers::{cells, clean, select, text},
};
use regex::Regex;
use scraper::Html;

pub fn extract(html: &str) -> Result<String> {
    let lower = html.to_lowercase();
    if lower.contains("concurrent") && lower.contains("terminate") {
        return Err(CoreError::new(ErrorCode::SessionConflict));
    }
    if let Some(m) = Regex::new(r"(?s)pageSanitizer\.sanitize\('((?:\\.|[^'\\])*)'\)")
        .unwrap()
        .captures(html)
    {
        return unescape(&m[1]);
    }
    let doc = Html::parse_document(html);
    if let Some(value) = doc
        .select(&select("div.zc-pb-embed-placeholder-content[zmlvalue]"))
        .next()
        .and_then(|n| n.value().attr("zmlvalue"))
    {
        return Ok(value.replace("\\-", "-").replace("\\/", "/"));
    }
    // Resilience improvement: accept already-unwrapped SRM tables.
    if doc.select(&select("table")).next().is_some() {
        return Ok(html.to_owned());
    }
    Err(CoreError::new(ErrorCode::ParserFailure))
}
fn unescape(raw: &str) -> Result<String> {
    let mut chars = raw.chars();
    let mut out = String::new();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars
            .next()
            .ok_or_else(|| CoreError::new(ErrorCode::ParserFailure))?
        {
            'n' => out.push('\n'),
            'r' => out.push('\r'),
            't' => out.push('\t'),
            kind @ ('u' | 'x') => {
                let length = if kind == 'u' { 4 } else { 2 };
                let hex: String = chars.by_ref().take(length).collect();
                if hex.len() != length {
                    return Err(CoreError::new(ErrorCode::ParserFailure));
                }
                let mut value = u32::from_str_radix(&hex, 16)
                    .map_err(|_| CoreError::new(ErrorCode::ParserFailure))?;
                if (0xd800..=0xdbff).contains(&value) {
                    if chars.next() != Some('\\') || chars.next() != Some('u') {
                        return Err(CoreError::new(ErrorCode::ParserFailure));
                    }
                    let low_hex = chars.by_ref().take(4).collect::<String>();
                    if low_hex.len() != 4 {
                        return Err(CoreError::new(ErrorCode::ParserFailure));
                    }
                    let low = u32::from_str_radix(&low_hex, 16)
                        .map_err(|_| CoreError::new(ErrorCode::ParserFailure))?;
                    if !(0xdc00..=0xdfff).contains(&low) {
                        return Err(CoreError::new(ErrorCode::ParserFailure));
                    }
                    value = 0x10000 + ((value - 0xd800) << 10) + (low - 0xdc00);
                }
                out.push(
                    char::from_u32(value)
                        .ok_or_else(|| CoreError::new(ErrorCode::ParserFailure))?,
                );
            }
            escaped => out.push(escaped),
        }
    }
    Ok(out)
}

pub fn attendance(html: &str) -> Result<AttendanceData> {
    let doc = Html::parse_document(html);
    let code = Regex::new(r"^[A-Z0-9]{8,12}").unwrap();
    let mut attendance = Vec::new();
    let mut candidate = false;
    for row in doc.select(&select("tr")) {
        let c = cells(row);
        if c.len() < 9 || !code.is_match(&c[0]) {
            continue;
        }
        candidate = true;
        if let (Ok(conducted), Ok(absent), Ok(percent)) = (
            c[6].parse::<u32>(),
            c[7].parse::<u32>(),
            c[8].parse::<f64>(),
        ) {
            if absent > conducted || !percent.is_finite() {
                continue;
            }
            attendance.push(Attendance {
                code: c[0].replace("Regular", "").trim().into(),
                title: c[1].clone(),
                category: c[2].clone(),
                slot: c[4].clone(),
                conducted,
                absent,
                present: conducted - absent,
                percent,
                is_portal: false,
            });
        }
    }
    if attendance.is_empty()
        && (candidate
            || !html.to_lowercase().contains("att")
            || doc.select(&select("table")).next().is_none())
    {
        return Err(CoreError::new(ErrorCode::ParserFailure));
    }
    Ok(AttendanceData {
        attendance,
        monthly: vec![],
    })
}

pub fn profile(html: &str) -> Result<Profile> {
    let doc = Html::parse_document(html);
    let mut profile = Profile::default();
    let mut recognized = false;
    for row in doc.select(&select("tr")) {
        let nodes: Vec<_> = row.select(&select("td")).collect();
        for pair in nodes.windows(2) {
            let label = text(pair[0]).to_lowercase();
            let value = text(pair[1]);
            if label.contains("registration number") || label.contains("register no") {
                profile.reg_no = value;
                recognized = true;
            } else if label.contains("student name") || label == "name" {
                profile.name = value;
                recognized = true;
            } else if label.contains("mobile") || label.contains("email id") {
                profile.mobile = value;
            } else if label.contains("program") {
                profile.program = value;
            } else if label.contains("semester") {
                profile.semester = value;
            } else if label.contains("batch") {
                profile.batch = value.split('/').next_back().unwrap_or(&value).trim().into();
            } else if label.contains("department") || label.contains("institution") {
                profile.dept = value;
                if let Some(font) = pair[1].select(&select("font")).next() {
                    profile.section = text(font);
                    profile.dept = profile
                        .dept
                        .replace(&profile.section, "")
                        .trim_end_matches(['-', ' '])
                        .into();
                }
            }
        }
    }
    if recognized {
        Ok(profile)
    } else {
        Err(CoreError::new(ErrorCode::ParserFailure))
    }
}

pub fn courses(html: &str) -> Result<CourseMap> {
    let doc = Html::parse_document(html);
    let table = doc
        .select(&select("table"))
        .find(|t| text(*t).contains("Course Code"))
        .ok_or_else(|| CoreError::new(ErrorCode::ParserFailure))?;
    let c: Vec<_> = table.select(&select("td")).map(text).collect();
    let start = c
        .windows(2)
        .position(|p| {
            p[0] == "1"
                && (p[1].chars().next().is_some_and(|n| n.is_ascii_digit()) || p[1].len() > 4)
        })
        .unwrap_or(0);
    let mut map = CourseMap::new();
    for c in c[start..].as_chunks::<11>().0 {
        if c[1].len() < 3 {
            continue;
        }
        for slot in c[8]
            .split(['-', '/', ',', '+', ' '])
            .filter(|s| !s.is_empty())
        {
            let up = slot.to_uppercase();
            let practical = up.starts_with('P') || up.starts_with('L') || up == "LAB";
            map.insert(
                slot.into(),
                Course {
                    code: c[1].clone(),
                    name: c[2].clone(),
                    credits: c[3].clone(),
                    kind: if practical { "Practical" } else { "Theory" }.into(),
                    raw_type: c[6].clone(),
                    faculty: if c[7].contains("Lab Based") {
                        "Unknown".into()
                    } else {
                        c[7].clone()
                    },
                    room: c[9].clone(),
                    slot: c[8].clone(),
                    title: None,
                    building: None,
                    floor: None,
                    room_name: None,
                },
            );
        }
    }
    Ok(map)
}

pub fn timetable(html: &str, courses: &CourseMap) -> Result<Schedule> {
    let doc = Html::parse_document(html);
    let table = doc
        .select(&select("table"))
        .find(|t| {
            let s = text(*t).to_lowercase();
            s.contains("day 1") && s.contains("08:00")
        })
        .ok_or_else(|| CoreError::new(ErrorCode::ParserFailure))?;
    let first = table
        .select(&select("tr"))
        .next()
        .ok_or_else(|| CoreError::new(ErrorCode::ParserFailure))?;
    let times: Vec<_> = cells(first)
        .into_iter()
        .filter(|t| t.contains(':') && !t.to_lowercase().contains("day"))
        .collect();
    if times.is_empty() {
        return Err(CoreError::new(ErrorCode::ParserFailure));
    }
    let day = Regex::new(r"(?i)Day\s*(\d+)").unwrap();
    let mut schedule = Schedule::new();
    for row in table.select(&select("tr")) {
        let c = cells(row);
        if c.is_empty() {
            continue;
        }
        let Some(m) = day.captures(&c[0]) else {
            continue;
        };
        let entries = schedule.entry(format!("Day {}", &m[1])).or_default();
        for (value, time) in c.iter().skip(1).zip(&times) {
            let slot = value.split('/').next().unwrap_or("").trim();
            if let Some(course) = courses.get(slot) {
                let mut entry = ScheduleSlot::from_course(course, time.clone(), false);
                entry.slot = slot.into();
                entries.insert(time.clone(), entry);
            }
        }
    }
    Ok(schedule)
}

pub fn marks(html: &str) -> Result<Vec<Marks>> {
    let doc = Html::parse_document(html);
    let code = Regex::new(r"^[A-Z0-9]{8,12}$").unwrap();
    let mut marks = Vec::new();
    for row in doc.select(&select("tr")) {
        let nodes: Vec<_> = row.select(&select("td")).collect();
        if nodes.len() < 3 || !code.is_match(&text(nodes[0])) {
            continue;
        }
        let mut assessments = Vec::new();
        let mut got = 0.0;
        let mut max = 0.0;
        let mut valid = false;
        if let Some(table) = nodes[2].select(&select("table")).next() {
            for td in table.select(&select("td")) {
                let parts: Vec<_> = td
                    .text()
                    .flat_map(|s| s.split('\n'))
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .collect();
                if parts.len() < 2 {
                    continue;
                }
                let (title, total) = parts[0].split_once('/').unwrap_or((parts[0], "0"));
                assessments.push(Assessment {
                    title: clean(title),
                    marks: parts[1].into(),
                    total: clean(total),
                    date: None,
                });
                if let (Ok(a), Ok(b)) = (parts[1].parse::<f64>(), total.trim().parse::<f64>())
                    && a.is_finite()
                    && b.is_finite()
                {
                    got += a;
                    max += b;
                    valid = true;
                }
            }
        }
        marks.push(Marks {
            course_code: text(nodes[0]),
            title: None,
            kind: text(nodes[1]),
            performance: if valid {
                format!("{got}/{max}")
            } else {
                "N/A".into()
            },
            assessments,
            total_got: valid.then_some(got),
            total_max: valid.then_some(max),
        });
    }
    if doc.select(&select("table")).next().is_none()
        || (marks.is_empty()
            && attendance(html).is_err()
            && !crate::parsers::recognized_empty_marks(&doc))
    {
        return Err(CoreError::new(ErrorCode::ParserFailure));
    }
    Ok(marks)
}
