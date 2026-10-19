/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  register: vi.fn(),
  signOut: vi.fn(),
  authListener: vi.fn(),
}));

vi.mock("./firebaseClient", () => ({ firebaseClient: { auth: {}, functions: {} } }));
vi.mock("./backendApi", () => ({
  createFirebaseCallableInvoker: vi.fn(() => vi.fn()),
  createGrowthEngineApi: vi.fn(() => ({})),
}));
vi.mock("firebase/auth", () => ({
  createUserWithEmailAndPassword: mocks.register,
  onAuthStateChanged: (_auth: unknown, callback: (user: null) => void) => { mocks.authListener(); callback(null); return () => undefined; },
  signInWithEmailAndPassword: mocks.signIn,
  signOut: mocks.signOut,
}));
import CloudWorkspace from "./CloudWorkspace";

afterEach(() => cleanup());
beforeEach(() => { vi.clearAllMocks(); mocks.signIn.mockResolvedValue({}); mocks.register.mockResolvedValue({}); });

describe("cloud authentication gate", () => {
  it("shows email/password sign-in and explains the dedicated project boundary", () => {
    render(<CloudWorkspace />);
    expect(screen.getByRole("heading", { name: "Sign in to Growth Engine" })).toBeTruthy();
    expect(screen.getByLabelText("Email address")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByText(/not production AnyTrader/i)).toBeTruthy();
  });

  it("submits sign-in credentials through Firebase Auth", async () => {
    render(<CloudWorkspace />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "pilot@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "testing-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledWith({}, "pilot@example.test", "testing-password"));
  });

  it("offers account creation without weakening the required password length", () => {
    render(<CloudWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: /Need an account/i }));
    expect(screen.getByRole("heading", { name: "Create your account" })).toBeTruthy();
    expect((screen.getByLabelText("Password") as HTMLInputElement).minLength).toBe(6);
  });
});
