/** Where a record is shown in the app (search, calendar and timeline). */
export function routeFor(type: string, id: string, date?: string): string {
  switch (type) {
    case "item":
      return `/bolig?id=${id}`;
    case "lending":
      return `/bolig?tab=lending&udlaan=${id}`;
    case "pet":
      return `/bolig?tab=pets&pet=${id}`;
    case "work_order":
      return `/arbejdsordrer?id=${id}`;
    case "task":
      return `/opgaver?task=${id}`;
    case "vehicle":
      return `/bil?id=${id}`;
    case "policy":
      return `/forsikring?id=${id}`;
    case "document":
      return `/dokumenter?id=${id}`;
    case "recurring_expense":
      return "/okonomi?tab=recurring";
    case "loan":
      return `/okonomi?tab=loans&loan=${id}`;
    case "bank_transaction":
      return "/okonomi?tab=tx";
    case "recipe":
      return `/madplan?tab=recipes&opskrift=${id}`;
    case "meal_plan_entry":
      return date ? `/madplan?uge=${date}` : "/madplan";
    case "person":
      return `/helbred?person=${id}`;
    default:
      return "/";
  }
}
