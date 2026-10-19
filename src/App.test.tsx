/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";

afterEach(() => cleanup());
beforeEach(() => window.localStorage.clear());

describe("Growth Engine interactive workflows", () => {
  it("renders the demo workspace shell and all navigation sections", () => {
    render(<App />);
    expect(screen.getByText("Growth Engine")).toBeTruthy();
    expect(screen.getByText("DEMO MODE")).toBeTruthy();
    for (const label of ["Overview", "Campaigns", "Lead directory", "Review queue", "Outreach drafts", "Workspace settings"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeTruthy();
    }
    expect(screen.getByText(/synthetic data/i)).toBeTruthy();
    expect(screen.getByText(/Nothing is sent automatically/i)).toBeTruthy();
  });

  it("creates a campaign and shows a confirmation", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /New campaign/i }));
    fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "Leeds roofing pilot" } });
    fireEvent.change(screen.getByLabelText("Service category"), { target: { value: "Roofers" } });
    fireEvent.change(screen.getByLabelText("Target location"), { target: { value: "Leeds, UK" } });
    fireEvent.click(within(screen.getByRole("heading", { name: "Create a campaign" }).closest("section") as HTMLElement).getByRole("button", { name: "Create campaign" }));
    expect(screen.getByText("Leeds roofing pilot")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("created in this browser's demo workspace");
  });

  it("marks a lead do-not-contact and disables its draft action", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Lead directory/i }));
    const row = screen.getByText("Fictional Northside Painting Co").closest("tr");
    expect(row).toBeTruthy();
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Details" }));
    fireEvent.click(screen.getByRole("button", { name: /Mark do not contact/i }));
    expect(screen.getByRole("status").textContent).toContain("marked Do not contact");
    expect(within(row as HTMLElement).getByRole("button", { name: /Draft/i }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("DO NOT CONTACT")).toBeTruthy();
  });

  it("creates a human-review draft for a contactable lead without sending anything", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Lead directory/i }));
    const row = screen.getByText("Fictional Northside Painting Co").closest("tr");
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: /Draft/i }));
    expect(screen.getByText("DRAFT · NOT SENT")).toBeTruthy();
    expect(screen.getByText(/Nothing has been sent/i)).toBeTruthy();
  });

  it("imports a reviewed CSV row only after explicit confirmation", async () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Lead directory/i }));
    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).toBeTruthy();
    const csv = new File(
      ["businessName,category,location,email\nNorth Star Roofing,Roofers,Leeds,hello@northstar.example\n"],
      "pilot-leads.csv",
      { type: "text/csv" },
    );
    fireEvent.change(fileInput as HTMLInputElement, { target: { files: [csv] } });

    await waitFor(() => expect(screen.getByRole("heading", { name: "Match your spreadsheet columns" })).toBeTruthy());
    expect(screen.getByText(/Confirm the column mapping/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Preview rows" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Review CSV before importing" })).toBeTruthy());
    expect(screen.getByText("North Star Roofing")).toBeTruthy();
    expect(screen.queryByText(/Import complete:/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Confirm import \(1\)/i }));
    expect(screen.getByRole("status").textContent).toContain("Import complete: 1 added");
    expect(screen.getByText("North Star Roofing")).toBeTruthy();
    const importedRow = screen.getByText("North Star Roofing").closest("tr");
    expect(within(importedRow as HTMLElement).getByText("PENDING REVIEW")).toBeTruthy();
    expect(within(importedRow as HTMLElement).getByRole("button", { name: /Draft/i })).toBeDisabled();
  });

  it("persists a created campaign when the workspace is remounted", () => {
    const firstRender = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /New campaign/i }));
    fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "Persistence test campaign" } });
    fireEvent.click(within(screen.getByRole("heading", { name: "Create a campaign" }).closest("section") as HTMLElement).getByRole("button", { name: "Create campaign" }));
    expect(screen.getByText("Persistence test campaign")).toBeTruthy();
    firstRender.unmount();

    render(<App />);
    expect(screen.getByText("Persistence test campaign")).toBeTruthy();
  });


  it("imports only the CSV candidates explicitly selected during review", async () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Lead directory/i }));
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const csv = new File(
      ["businessName,category,location,email\nNorth Star Roofing,Roofers,Leeds,hello@northstar.example\nSouth City Painting,Painters,Manchester,hello@southcity.example\n"],
      "selected-leads.csv",
      { type: "text/csv" },
    );
    fireEvent.change(fileInput, { target: { files: [csv] } });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Match your spreadsheet columns" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Preview rows" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Review CSV before importing" })).toBeTruthy());

    fireEvent.click(screen.getByRole("checkbox", { name: "Include North Star Roofing in import" }));
    expect(screen.getByText("South City Painting")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm import (1)" }));

    expect(screen.getByText("South City Painting")).toBeTruthy();
    expect(screen.queryByText("North Star Roofing")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("1 added");
    expect(screen.getByRole("status").textContent).toContain("1 rows excluded");
  });

  it("cancels a CSV preview without adding any candidate rows", async () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Lead directory/i }));
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const csv = new File(
      ["businessName,category,location\nCancelled Test Roofing,Roofers,Leeds\n"],
      "cancelled-leads.csv",
      { type: "text/csv" },
    );
    fireEvent.change(fileInput, { target: { files: [csv] } });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Match your spreadsheet columns" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Preview rows" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Review CSV before importing" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Cancel import preview" }));
    expect(screen.queryByRole("heading", { name: "Review CSV before importing" })).toBeNull();
    expect(screen.queryByText("Cancelled Test Roofing")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("CSV import cancelled");
  });

  it("flags an already-created draft if its lead is later suppressed", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Lead directory/i }));
    const row = screen.getByText("Fictional Northside Painting Co").closest("tr");
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: /Draft/i }));
    expect(screen.getByText("DRAFT · NOT SENT")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Lead directory/i }));
    const refreshedRow = screen.getByText("Fictional Northside Painting Co").closest("tr");
    fireEvent.click(within(refreshedRow as HTMLElement).getByRole("button", { name: "Details" }));
    fireEvent.click(screen.getByRole("button", { name: /Mark do not contact/i }));
    fireEvent.click(screen.getByRole("button", { name: /Outreach drafts/i }));

    expect(screen.getByText("DO NOT CONTACT")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Do not use this saved draft for outreach");
  });

});
