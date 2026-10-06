use ratiod_core::{academic_parsers as a, parsers, portal_parsers as p};
use serde_json::{Value, json};
#[test]
fn active_python_parsers_match_rust_on_synthetic_fixtures() {
    let expected: Value = serde_json::from_str(include_str!("fixtures/expected.json")).unwrap();
    let academic = include_str!("fixtures/academia.html");
    let courses = a::courses(academic).unwrap();
    let actual = json!({
        "academiaAttendance":a::attendance(academic).unwrap(),
        "academiaProfile":a::profile(academic).unwrap(),
        "academiaMarks":a::marks(academic).unwrap(),
        "academiaTimetable":{"courses":courses,"schedule":a::timetable(include_str!("fixtures/academia-grid.html"),&courses).unwrap()},
        "portalAttendance":parsers::portal_attendance(include_str!("fixtures/portal-attendance.html")).unwrap(),
        "portalProfile":p::profile(include_str!("fixtures/portal-profile.html")).unwrap(),
        "portalTimetable":p::timetable(include_str!("fixtures/portal-timetable.html")).unwrap()
    });
    for (key, value) in actual.as_object().unwrap() {
        assert_eq!(value, &expected[key], "Parser mismatch for {key}");
    }
}
#[test]
fn academia_wrapper_decoding_handles_escapes_and_entities() {
    assert_eq!(
        a::extract(r#"<script>pageSanitizer.sanitize('<table>\x41\u0026\-\/</table>')</script>"#)
            .unwrap(),
        "<table>A&-/</table>"
    );
    assert_eq!(a::extract(r#"<div class="zc-pb-embed-placeholder-content" zmlvalue="&lt;table&gt;example&lt;/table&gt;"></div>"#).unwrap(),"<table>example</table>");
    assert!(a::extract("concurrent sessions terminate").is_err());
    for malformed in [
        r"pageSanitizer.sanitize('\x4')",
        r"pageSanitizer.sanitize('\u123')",
        r"pageSanitizer.sanitize('\ud800\udc0')",
    ] {
        assert!(a::extract(malformed).is_err());
    }
}
