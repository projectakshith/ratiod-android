use serde::Serialize;

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Attendance {
    pub code: String,
    pub title: String,
    pub category: String,
    pub slot: String,
    pub conducted: u32,
    pub absent: u32,
    pub present: u32,
    pub percent: f64,
    #[serde(rename = "isPortal")]
    pub is_portal: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Monthly {
    pub month: String,
    pub present: u32,
    pub absent: u32,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct AttendanceData {
    pub attendance: Vec<Attendance>,
    pub monthly: Vec<Monthly>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub name: String,
    pub reg_no: String,
    pub batch: String,
    pub semester: String,
    pub dept: String,
    pub section: String,
    pub mobile: String,
    pub program: String,
}
impl Default for Profile {
    fn default() -> Self {
        Self {
            name: String::new(),
            reg_no: "Unknown".into(),
            batch: "N/A".into(),
            semester: "N/A".into(),
            dept: "N/A".into(),
            section: "N/A".into(),
            mobile: "N/A".into(),
            program: "N/A".into(),
        }
    }
}
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Assessment {
    pub title: String,
    pub marks: String,
    pub total: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Marks {
    #[serde(rename = "courseCode")]
    pub course_code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(rename = "type")]
    pub kind: String,
    pub performance: String,
    pub assessments: Vec<Assessment>,
    #[serde(rename = "totalMarkGot")]
    pub total_got: Option<f64>,
    #[serde(rename = "totalMaxMarks")]
    pub total_max: Option<f64>,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Course {
    pub code: String,
    pub name: String,
    pub credits: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub raw_type: String,
    pub faculty: String,
    pub room: String,
    pub slot: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub building: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub floor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub room_name: Option<String>,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct ScheduleSlot {
    pub code: String,
    pub course: String,
    pub slot: String,
    pub time: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub raw_type: String,
    pub room: String,
    pub faculty: String,
    #[serde(rename = "courseCode", skip_serializing_if = "Option::is_none")]
    pub course_code: Option<String>,
    #[serde(rename = "courseTitle", skip_serializing_if = "Option::is_none")]
    pub course_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credits: Option<String>,
}
impl ScheduleSlot {
    pub fn from_course(course: &Course, time: String, portal: bool) -> Self {
        Self {
            code: course.code.clone(),
            course: course.name.clone(),
            slot: course.slot.clone(),
            time,
            kind: course.kind.clone(),
            raw_type: course.raw_type.clone(),
            room: course.room.clone(),
            faculty: course.faculty.clone(),
            course_code: portal.then(|| course.code.clone()),
            course_title: portal.then(|| course.name.clone()),
            name: portal.then(|| course.name.clone()),
            credits: portal.then(|| course.credits.clone()),
        }
    }
}
pub type CourseMap = std::collections::BTreeMap<String, Course>;
pub type Schedule =
    std::collections::BTreeMap<String, std::collections::BTreeMap<String, ScheduleSlot>>;
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct TimetableData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<Profile>,
    pub schedule: Schedule,
    pub courses: CourseMap,
}
