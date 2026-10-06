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
