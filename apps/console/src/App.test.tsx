// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";

describe("App auth gate", () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
  });

  it("shows the dev sign-in form when there is no session and no Clerk key", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "Reviewer Console" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Bearer token")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });
});
