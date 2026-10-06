//! Behavior adapted from ratio-d's active Python parsers (see porting notes).
use crate::{
    error::{CoreError, ErrorCode, Result},
    models::*,
};
use regex::Regex;
use scraper::{ElementRef, Html, Selector};

pub(crate) fn select(css: &str) -> Selector {
    Selector::parse(css).expect("static CSS selector")
}
pub(crate) fn clean(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}
pub(crate) fn text(element: ElementRef<'_>) -> String {
    clean(&element.text().collect::<Vec<_>>().join(" "))
}
pub(crate) fn cells(row: ElementRef<'_>) -> Vec<String> {
    row.select(&select("td, th")).map(text).collect()
}

pub fn portal_attendance(html: &str) -> Result<AttendanceData> {
    let document = Html::parse_document(html);
    let code = Regex::new(r"^[A-Z0-9]{6,12}$").unwrap();
    let month = Regex::new(r"^[A-Za-z]{3}-\d{4}$").unwrap();
    let mut attendance = Vec::new();
    let mut monthly = Vec::new();
    let mut candidate = false;
    for row in document.select(&select("table tr")) {
        let values = cells(row);
        if values.is_empty() {
            continue;
        }
        if code.is_match(&values[0]) && values.len() >= 6 {
            candidate = true;
            if let (Ok(conducted), Ok(present), Ok(absent), Ok(percent)) = (
                values[2].parse::<u32>(),
                values[3].parse::<u32>(),
                values[4].parse::<u32>(),
                values[5].parse::<f64>(),
            ) {
                if !percent.is_finite() {
                    continue;
                }
                attendance.push(Attendance {
                    code: values[0].clone(),
                    title: values[1].clone(),
                    category: "Theory".into(),
                    slot: String::new(),
                    conducted,
                    absent,
                    present,
                    percent,
                    is_portal: true,
                });
            }
        } else if month.is_match(&values[0]) && values.len() >= 3 {
            if let (Ok(present), Ok(absent)) = (values[1].parse(), values[2].parse()) {
                monthly.push(Monthly {
                    month: values[0].clone(),
                    present,
                    absent,
                });
            }
        }
    }
    if attendance.is_empty()
        && (candidate
            || !html.to_lowercase().contains("attendance")
            || document.select(&select("table")).next().is_none())
    {
        return Err(CoreError::new(ErrorCode::ParserFailure));
    }
    attendance.sort_by(|a, b| {
        a.percent
            .total_cmp(&b.percent)
            .then(a.conducted.cmp(&b.conducted))
    });
    Ok(AttendanceData {
        attendance,
        monthly,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn portal_parses_entities_nested_tags_and_months() {
        let result = portal_attendance("<h1>Attendance</h1><table><tr><td>21CSC101J</td><td><b>Example &amp; Course</b></td><td>10</td><td>8</td><td>2</td><td>80</td></tr><tr><td>Oct-2026</td><td>8</td><td>2</td></tr></table>").unwrap();
        assert_eq!(result.attendance[0].title, "Example & Course");
        assert_eq!(result.monthly[0].absent, 2);
    }
    #[test]
    fn malformed_page_is_not_successful_empty_data() {
        assert!(portal_attendance("<html>maintenance</html>").is_err());
        assert!(portal_attendance("<h1>Attendance</h1><table><tr><td>21CSC101J</td><td>x</td><td>broken</td><td>0</td><td>0</td><td>0</td></tr></table>").is_err());
        assert!(
            portal_attendance("<h1>Attendance</h1><table><tr><td>No records</td></tr></table>")
                .unwrap()
                .attendance
                .is_empty()
        );
    }
}
