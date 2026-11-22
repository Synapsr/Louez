import assert from "node:assert/strict";
import { test } from "node:test";

import { DEMO_VISITOR_EMAIL, withDemoVisitorContact } from "./demo-checkout";

test("a demo checkout books with the invented contact, whatever the form sent", () => {
  const booked = withDemoVisitorContact({
    email: "someone.real@gmail.com",
    phone: "+33612345678",
    firstName: "Téo",
    lastName: "Visiteur",
  });
  assert.equal(booked.email, DEMO_VISITOR_EMAIL);
  assert.match(booked.email, /\.example$/);
  assert.match(String(booked.phone), /^06 39 98/);
  assert.equal(booked.firstName, "Téo");
});
