"use client";

import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

type LoginMode = "password" | "pin";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<LoginMode>("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const result = await signIn("credentials", {
        redirect: false,
        username: mode === "password" ? username : undefined,
        password: mode === "password" ? password : undefined,
        pin: mode === "pin" ? pin : undefined,
        loginType: mode,
      });

      if (result?.error) {
        setError(
          result.error === "Configuration"
            ? "Server error — restart the dev server after npm install. If it persists, run: npm rebuild better-sqlite3"
            : mode === "pin"
              ? "Invalid PIN. Please try again."
              : "Invalid username or password.",
        );
        if (mode === "pin") {
          setPin("");
        } else {
          setPassword("");
        }
        return;
      }

      router.push("/pos");
      router.refresh();
    } catch {
      setError("Login failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function appendPinDigit(digit: string) {
    if (pin.length < 4) {
      setPin((current) => `${current}${digit}`);
    }
  }

  function backspacePin() {
    setPin((current) => current.slice(0, -1));
  }

  return (
    <div className="flex min-h-full flex-1 items-center justify-center bg-zinc-100 px-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-zinc-900">GroceryRMS</h1>
          <p className="mt-2 text-sm text-zinc-500">Sign in to continue</p>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-2 rounded-lg bg-zinc-100 p-1">
          <button
            type="button"
            onClick={() => {
              setMode("password");
              setError("");
              setPin("");
            }}
            className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              mode === "password"
                ? "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-600 hover:text-zinc-900"
            }`}
          >
            Password
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("pin");
              setError("");
              setUsername("");
              setPassword("");
            }}
            className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              mode === "pin"
                ? "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-600 hover:text-zinc-900"
            }`}
          >
            Quick PIN
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "password" ? (
            <>
              <div>
                <label
                  htmlFor="username"
                  className="mb-1 block text-sm font-medium text-zinc-700"
                >
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 outline-none ring-zinc-400 focus:ring-2"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="password"
                  className="mb-1 block text-sm font-medium text-zinc-700"
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 outline-none ring-zinc-400 focus:ring-2"
                  required
                />
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-700">
                  4-digit PIN
                </label>
                <div className="flex justify-center gap-3 py-2">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div
                      key={index}
                      className="flex h-12 w-12 items-center justify-center rounded-lg border border-zinc-300 text-xl font-semibold text-zinc-900"
                    >
                      {pin[index] ? "•" : ""}
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
                  <button
                    key={digit}
                    type="button"
                    onClick={() => appendPinDigit(digit)}
                    className="rounded-lg border border-zinc-200 py-3 text-lg font-medium text-zinc-800 hover:bg-zinc-50"
                  >
                    {digit}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={backspacePin}
                  className="rounded-lg border border-zinc-200 py-3 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
                >
                  Del
                </button>
                <button
                  type="button"
                  onClick={() => appendPinDigit("0")}
                  className="rounded-lg border border-zinc-200 py-3 text-lg font-medium text-zinc-800 hover:bg-zinc-50"
                >
                  0
                </button>
                <div />
              </div>
            </div>
          )}

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={
              isSubmitting || (mode === "pin" ? pin.length !== 4 : false)
            }
            className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
