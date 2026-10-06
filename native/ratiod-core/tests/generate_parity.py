"""Regenerate expected results with the pinned ratio-d backend checkout.

Usage: python generate_parity.py /path/to/ratio-d/backend
Fixtures are entirely synthetic; do not substitute production student pages.
"""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(sys.argv[1]).resolve()))
from services.attendance_service import AttendanceService
from services.marks_service import MarksService
from services.profile_service import ProfileService
from services.course_service import CourseService
from services.timetable_service import TimetableService
from services.portal_attendance_service import PortalAttendanceService
from services.portal_profile_service import PortalProfileService
from services.portal_marks_service import PortalMarksService
from services.portal_timetable_service import PortalTimetableService

root = Path(__file__).parent / "fixtures"
read = lambda name: (root / name).read_text()
html = read("academia.html")
courses = CourseService.get_course_map(html)
profile = ProfileService.parse_student_profile(html)
profile["batch"] = profile["batch"].split("/")[-1].strip()
# Rust deliberately removes the dangling separator left by Python's trim order.
profile["dept"] = profile["dept"].rstrip("- ")
att = AttendanceService.parse_attendance(html)
for course in att:
    course.update(present=course["conducted"] - course["absent"], isPortal=False)
portal_att, monthly = PortalAttendanceService.parse(read("portal-attendance.html"))
schedule, portal_courses = PortalTimetableService.parse(read("portal-timetable.html"))
expected = {
    "academiaAttendance": {"attendance": att, "monthly": []},
    "academiaProfile": profile,
    "academiaMarks": MarksService.parse_test_performance(html),
    "academiaTimetable": {"schedule": TimetableService.parse_unified_grid(read("academia-grid.html"), courses), "courses": courses},
    "portalAttendance": {"attendance": portal_att, "monthly": monthly},
    "portalProfile": PortalProfileService.parse(read("portal-profile.html")),
    "portalTimetable": {"schedule": schedule, "courses": portal_courses},
}
subjects = PortalMarksService.parse_main(read("portal-marks.html"))
for subject in subjects:
    subject.pop("subjectId")
    subject.pop("status")
    subject["assessments"] = PortalMarksService.parse_inner(read("portal-inner.html"))
# PortalSession.get_marks_data appends attendance-only courses in this shape.
codes = {subject["courseCode"].strip().lower() for subject in subjects}
for course in portal_att:
    if course["code"].strip().lower() not in codes:
        subjects.append({"courseCode": course["code"], "title": course["title"],
                         "type": "Internal", "performance": "N/A", "assessments": [],
                         "totalMarkGot": None, "totalMaxMarks": None})
expected["portalMarks"] = subjects
(root / "expected.json").write_text(json.dumps(expected, indent=2) + "\n")
print("Generated synthetic parser expectations.")
