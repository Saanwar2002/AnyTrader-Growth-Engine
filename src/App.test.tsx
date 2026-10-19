import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("Growth Engine app render smoke tests", () => {
  it("renders the demo workspace shell and navigation", () => {
    const markup = renderToStaticMarkup(createElement(App));

    expect(markup).toContain("Growth Engine");
    expect(markup).toContain("DEMO MODE");
    expect(markup).toContain("Overview");
    expect(markup).toContain("Campaigns");
    expect(markup).toContain("Lead directory");
    expect(markup).toContain("Review queue");
    expect(markup).toContain("Outreach drafts");
    expect(markup).toContain("Workspace settings");
  });

  it("clearly labels the initial data as synthetic and confirms messages are not sent", () => {
    const markup = renderToStaticMarkup(createElement(App));

    expect(markup).toContain("You&#x27;re exploring with synthetic data");
    expect(markup).toContain("Nothing is sent automatically");
    expect(markup).toContain("No live data sources");
  });

  it("renders initial campaign and lead workflow metrics", () => {
    const markup = renderToStaticMarkup(createElement(App));

    expect(markup).toContain("Total leads");
    expect(markup).toContain("Active campaigns");
    expect(markup).toContain("Needs review");
    expect(markup).toContain("Qualified providers");
  });
});
