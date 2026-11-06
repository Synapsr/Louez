/** Minimal customer shape shared by the dashboard customer picker and quick-create dialog. */
export interface DashboardCustomer {
  id: string;
  /** Null for a customer entered by the team with only a phone. */
  email: string | null;
  firstName: string;
  lastName: string;
  phone: string | null;
}
