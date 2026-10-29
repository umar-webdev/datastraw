/** Ready-made customers for the Customer view (a test tool, see the brief). */
export const TEST_CUSTOMERS = [
  { id: "cust_1042", name: "Aisha Khan", phone: "+919800000001" },
  { id: "cust_1043", name: "Rohan Mehta", phone: "+919800000002" },
  { id: "cust_1044", name: "Priya Nair", phone: "+919800000003" },
] as const;

/** A stable customer id for someone typed into the Customer view, so the same phone reopens the same conversation. */
export function customerIdForPhone(phone: string): string {
  return "web_" + phone.replace(/\D/g, "");
}
