/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    expect((within(importedRow as HTMLElement).getByRole("button", { name: /Draft/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(importedRow as HTMLElement).getByRole("combobox", { name: "Change status for North Star Roofing" }), { target: { value: "contacted" } });
    expect(screen.getByRole("status").textContent).toContain("must pass contact review");
    expect((within(importedRow as HTMLElement).getByRole("combobox", { name: "Change status for North Star Roofing" }) as HTMLSelectElement).value).toBe("new");
    const contactFilter = screen.getByRole("combobox", { name: "Filter by contact permission" });
    fireEvent.change(contactFilter, { target: { value: "review" } });
    expect(screen.getByText("North Star Roofing")).toBeTruthy();
    fireEvent.change(contactFilter, { target: { value: "suppressed" } });
    expect(screen.queryByText("North Star Roofing")).toBeNull();
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
    expect((screen.getByRole("button", { name: "Edit draft" }) as HTMLButtonElement).disabled).toBe(true);
  });


  it("paginates CSV import candidates and preserves selections across pages", async () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Lead directory/i }));
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const rows = Array.from({ length: 10 }, (_, index) =>
      `Pagination Business ${index + 1},Roofers,Leeds,business${index + 1}@example.test`,
    );
    const csv = new File(
      [`businessName,category,location,email\n${rows.join("\n")}\n`],
      "paginated-leads.csv",
      { type: "text/csv" },
    );
    fireEvent.change(fileInput, { target: { files: [csv] } });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Match your spreadsheet columns" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Preview rows" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Review CSV before importing" })).toBeTruthy());

    expect(screen.getByText("Pagination Business 1")).toBeTruthy();
    expect(screen.queryByText("Pagination Business 9")).toBeNull();
    expect(screen.getByText("Page 1 of 2 · Showing 1–8 of 10")).toBeTruthy();
    const pagination = screen.getByRole("navigation", { name: "CSV import preview pagination" });
    expect(pagination).toBeTruthy();
    expect(pagination.querySelector("[aria-live=\"polite\"]")?.getAttribute("aria-atomic")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Next import page" }));
    expect(screen.getByText("Pagination Business 9")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Pagination Business 9 in import" }));
    expect((screen.getByRole("checkbox", { name: "Select all import candidates" }) as HTMLInputElement).indeterminate).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Previous import page" }));
    expect(screen.getByText("Pagination Business 1")).toBeTruthy();
    expect(screen.queryByText("Pagination Business 9")).toBeNull();
    expect(screen.getByText("Page 1 of 2 · Showing 1–8 of 10")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next import page" }));
    expect((screen.getByRole("checkbox", { name: "Include Pagination Business 9 in import" }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Pagination Business 9 in import" }));
    expect((screen.getByRole("checkbox", { name: "Select all import candidates" }) as HTMLInputElement).indeterminate).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Previous import page" }));

    fireEvent.click(screen.getByRole("button", { name: /Confirm import \(10\)/i }));
    expect(screen.getByRole("status").textContent).toContain("Import complete: 10 added");
    expect(screen.getByText("Pagination Business 9")).toBeTruthy();
  });

  it("exports campaign and contact-review context with the visible leads", async () => {
    let exportedBlob: Blob | undefined;
    const URLWithObjectUrls = class extends URL {};
    Object.assign(URLWithObjectUrls, {
      createObjectURL: vi.fn((blob: Blob) => { exportedBlob = blob; return "blob:export-test"; }),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal("URL", URLWithObjectUrls);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Lead directory/i }));
    fireEvent.click(screen.getByRole("button", { name: /Export CSV/i }));
    expect(exportedBlob).toBeDefined();
    const exportedText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(exportedBlob as Blob);
    });
    expect(exportedText).toContain("businessName,campaignName,category");
    expect(exportedText).toContain("doNotContact,contactReviewStatus");
    expect(exportedText).toContain("Fictional Northside Painting Co");
    expect(exportedText).toContain("Manchester painter pilot");
    expect(exportedText).toContain("unknown");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });


  it("exports only the leads matching the active search filter", async () => {
    let exportedBlob: Blob | undefined;
    const URLWithObjectUrls = class extends URL {};
    Object.assign(URLWithObjectUrls, {
      createObjectURL: vi.fn((blob: Blob) => { exportedBlob = blob; return "blob:filtered-export-test"; }),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal("URL", URLWithObjectUrls);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Lead directory/i }));
    fireEvent.change(screen.getByPlaceholderText("Search business, category, area, email, phone or website…"), {
      target: { value: "Fictional Northside Painting Co" },
    });
    expect(screen.getByText("Fictional Northside Painting Co")).toBeTruthy();
    expect(screen.queryByText("Sample BrightBrush Decorators")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Export CSV/i }));
    expect(exportedBlob).toBeDefined();
    const exportedText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(exportedBlob as Blob);
    });
    expect(exportedText).toContain("Fictional Northside Painting Co");
    expect(exportedText).not.toContain("Sample BrightBrush Decorators");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });


  it("exports only the leads matching the active status filter", async () => {
    let exportedBlob: Blob | undefined;
    const URLWithObjectUrls = class extends URL {};
    Object.assign(URLWithObjectUrls, {
      createObjectURL: vi.fn((blob: Blob) => { exportedBlob = blob; return "blob:status-filter-export-test"; }),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal("URL", URLWithObjectUrls);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Lead directory/i }));
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by lead status" }), {
      target: { value: "qualified" },
    });
    expect(screen.getByText("Demo Oak & Colour Ltd")).toBeTruthy();
    expect(screen.queryByText("Fictional Northside Painting Co")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Export CSV/i }));
    expect(exportedBlob).toBeDefined();
    const exportedText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(exportedBlob as Blob);
    });
    expect(exportedText).toContain("Demo Oak & Colour Ltd");
    expect(exportedText).not.toContain("Fictional Northside Painting Co");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });


  it("clears search, status, contact-permission and campaign filters together", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Lead directory/i }));

    const search = screen.getByPlaceholderText("Search business, category, area, email, phone or website…");
    const status = screen.getByRole("combobox", { name: "Filter by lead status" });
    const contact = screen.getByRole("combobox", { name: "Filter by contact permission" });
    const campaign = screen.getByRole("combobox", { name: "Filter by campaign" });
    const campaignOption = within(campaign).getAllByRole("option").find((option) => (option as HTMLOptionElement).value !== "all");
    expect(campaignOption).toBeTruthy();

    fireEvent.change(search, { target: { value: "Fictional Northside Painting Co" } });
    fireEvent.change(status, { target: { value: "qualified" } });
    fireEvent.change(contact, { target: { value: "suppressed" } });
    fireEvent.change(campaign, { target: { value: (campaignOption as HTMLOptionElement).value } });
    expect(screen.getByText("4 active filters")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("0 active filters")).toBeTruthy();

    expect((search as HTMLInputElement).value).toBe("");
    expect((status as HTMLSelectElement).value).toBe("all");
    expect((contact as HTMLSelectElement).value).toBe("all");
    expect((campaign as HTMLSelectElement).value).toBe("all");
    expect(screen.getByText("Fictional Northside Painting Co")).toBeTruthy();
    expect(screen.getByText("Sample BrightBrush Decorators")).toBeTruthy();
  });

  it("offers a clear-filters action when the lead directory has no matches", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Lead directory/i }));
    const search = screen.getByPlaceholderText("Search business, category, area, email, phone or website…");
    fireEvent.change(search, { target: { value: "no-such-business-match" } });

    expect(screen.getByText("No leads match these filters")).toBeTruthy();
    expect(screen.getByText("1 active filter")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters and show all leads" }));

    expect((search as HTMLInputElement).value).toBe("");
    expect(screen.getByText("Fictional Northside Painting Co")).toBeTruthy();
    expect(screen.getByText("Sample BrightBrush Decorators")).toBeTruthy();
    expect(screen.getByText("0 active filters")).toBeTruthy();
  });


  it("sorts visible leads by business name without changing the active filter count", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Lead directory/i }));
    const sort = screen.getByRole("combobox", { name: "Sort leads" });
    const rows = () => Array.from(document.querySelectorAll(".table-wrap tbody tr"));

    expect(rows()[0].textContent).toContain("Fictional Northside Painting Co");
    fireEvent.change(sort, { target: { value: "name" } });
    expect(rows()[0].textContent).toContain("Demo Oak & Colour Ltd");
    expect(rows()[1].textContent).toContain("Example FreshCoat Services");
    expect(screen.getByText("0 active filters")).toBeTruthy();

    fireEvent.change(sort, { target: { value: "default" } });
    expect(rows()[0].textContent).toContain("Fictional Northside Painting Co");
  });


  it("filters the lead directory by a category introduced through CSV import", async () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Lead directory/i }));
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const csv = new File(
      ["businessName,category,location,email\nNorth Star Roofing,Roofers,Leeds,hello@northstar.example\n"],
      "category-filter-leads.csv",
      { type: "text/csv" },
    );
    fireEvent.change(fileInput, { target: { files: [csv] } });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Match your spreadsheet columns" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Preview rows" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Review CSV before importing" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Confirm import (1)" }));
    expect(screen.getByText("North Star Roofing")).toBeTruthy();

    const category = screen.getByRole("combobox", { name: "Filter by service category" });
    fireEvent.change(category, { target: { value: "Roofers" } });
    expect(screen.getByText("North Star Roofing")).toBeTruthy();
    expect(screen.queryByText("Fictional Northside Painting Co")).toBeNull();
    expect(screen.getByText("1 active filter")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect((category as HTMLSelectElement).value).toBe("all");
    expect(screen.getByText("Fictional Northside Painting Co")).toBeTruthy();
    expect(screen.getByText("North Star Roofing")).toBeTruthy();
    expect(screen.getByText("0 active filters")).toBeTruthy();
  });


  it("resets category filtering and sorting when the demo workspace is reset", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Lead directory/i }));
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by service category" }), {
      target: { value: "Painters & decorators" },
    });
    const source = screen.getByRole("combobox", { name: "Filter by lead source" });
    fireEvent.change(source, { target: { value: "csv" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort leads" }), { target: { value: "name" } });
    expect(screen.getByText("2 active filters")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Workspace settings/i }));
    fireEvent.click(screen.getByRole("button", { name: "Reset demo workspace" }));
    expect(screen.getByRole("status").textContent).toContain("Demo workspace reset");

    fireEvent.click(screen.getByRole("button", { name: /Lead directory/i }));
    expect((screen.getByRole("combobox", { name: "Filter by service category" }) as HTMLSelectElement).value).toBe("all");
    expect((screen.getByRole("combobox", { name: "Filter by lead source" }) as HTMLSelectElement).value).toBe("all");
    expect((screen.getByRole("combobox", { name: "Sort leads" }) as HTMLSelectElement).value).toBe("default");
    expect(screen.getByText("0 active filters")).toBeTruthy();
    expect(document.querySelector(".table-wrap tbody tr")?.textContent).toContain("Fictional Northside Painting Co");
    vi.restoreAllMocks();
  });


  it("exposes an accessible name for lead search", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Lead directory/i }));
    expect(screen.getByRole("textbox", { name: "Search leads" })).toBeTruthy();
  });


  it("searches imported leads by phone number and website", async () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Lead directory/i }));
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const csv = new File(
      ["businessName,category,location,website,email,phone\nNorth Star Roofing,Roofers,Leeds,https://northstar-roofing.example,hello@northstar.example,+44 7700 900123\n"],
      "search-contact-fields.csv",
      { type: "text/csv" },
    );
    fireEvent.change(fileInput, { target: { files: [csv] } });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Match your spreadsheet columns" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Preview rows" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Review CSV before importing" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Confirm import (1)" }));
    expect(screen.getByText("North Star Roofing")).toBeTruthy();

    const search = screen.getByPlaceholderText("Search business, category, area, email, phone or website…");
    fireEvent.change(search, { target: { value: "+44 7700 900123" } });
    expect(screen.getByText("North Star Roofing")).toBeTruthy();
    expect(screen.queryByText("Fictional Northside Painting Co")).toBeNull();

    fireEvent.change(search, { target: { value: "northstar-roofing.example" } });
    expect(screen.getByText("North Star Roofing")).toBeTruthy();
    expect(screen.queryByText("Sample BrightBrush Decorators")).toBeNull();
  });


  it("filters leads by source and clears the source filter with the other controls", async () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Lead directory/i }));
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const csv = new File(
      ["businessName,category,location,website,email,phone\nNorth Star Roofing,Roofers,Leeds,https://northstar-roofing.example,hello@northstar.example,+44 7700 900123\n"],
      "source-filter-leads.csv",
      { type: "text/csv" },
    );
    fireEvent.change(fileInput, { target: { files: [csv] } });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Match your spreadsheet columns" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Preview rows" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Review CSV before importing" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Confirm import (1)" }));
    expect(screen.getByText("North Star Roofing")).toBeTruthy();

    const source = screen.getByRole("combobox", { name: "Filter by lead source" });
    fireEvent.change(source, { target: { value: "csv" } });
    expect(screen.getByText("North Star Roofing")).toBeTruthy();
    expect(screen.queryByText("Fictional Northside Painting Co")).toBeNull();
    expect(screen.getByText("1 active filter")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect((source as HTMLSelectElement).value).toBe("all");
    expect(screen.getByText("North Star Roofing")).toBeTruthy();
    expect(screen.getByText("Fictional Northside Painting Co")).toBeTruthy();
    expect(screen.getByText("0 active filters")).toBeTruthy();
  });

});
