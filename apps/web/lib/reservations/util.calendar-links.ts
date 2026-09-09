interface CalendarLinkInput {
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  timezone: string;
  location: string;
}

export const buildCalendarLinks = (event: CalendarLinkInput) => {
  const start = new Date(event.startDate).toISOString();
  const end = new Date(event.endDate).toISOString();
  const compact = (value: string) => value.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const google = new URL("https://calendar.google.com/calendar/r/eventedit");
  google.search = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    details: event.description,
    dates: `${compact(start)}/${compact(end)}`,
    stz: event.timezone,
    etz: event.timezone,
    location: event.location,
  }).toString();
  const outlookParams = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: event.title,
    body: event.description,
    startdt: start,
    enddt: end,
    location: event.location,
    allday: "false",
  });
  return {
    google: google.toString(),
    outlook: `https://outlook.live.com/calendar/0/deeplink/compose?${outlookParams}`,
    office: `https://outlook.office.com/calendar/0/deeplink/compose?${outlookParams}`,
  };
};
