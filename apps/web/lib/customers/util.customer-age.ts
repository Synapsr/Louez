/** Completed years between an ISO `yyyy-MM-dd` birth date and a day, or null when the date is unusable. */
export const getAgeFromBirthDate = (birthDate: string, today: Date = new Date()): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const hadBirthdayThisYear =
    today.getMonth() + 1 > month || (today.getMonth() + 1 === month && today.getDate() >= day);
  const age = today.getFullYear() - year - (hadBirthdayThisYear ? 0 : 1);
  return age >= 0 && age < 130 ? age : null;
};
