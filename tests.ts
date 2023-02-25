import {
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { Eksi, parseDate } from "./mod.ts";

const eksi = new Eksi();
console.log(await eksi.entry(59741));

Deno.test("parseDate", () => {
  assertEquals(parseDate("24.02.2023 18:41"), new Date(2023, 1, 24, 18, 41));
  assertEquals(
    parseDate("24.02.2023 18:34 ~ 22:55"),
    new Date(2023, 1, 24, 18, 34),
  );
});

Deno.test("Entries", async () => {
  const entries = await eksi.entries("deno");
  assertObjectMatch(entries[0], {
    id: 241257,
    title: "deno",
    text: `deniz ismindeki kizlarin default nicki..`,
  });
});
