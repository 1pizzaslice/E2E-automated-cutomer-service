// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App.js";

describe("App shell", () => {
  it("renders the console heading", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "Support Reviewer Console" }),
    ).toBeInTheDocument();
  });
});
