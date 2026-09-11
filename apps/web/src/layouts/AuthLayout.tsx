import { Lock, MessagesSquare, Zap } from "lucide-react";
import { Outlet } from "react-router";
import { Logo } from "@/components/Logo";

const FEATURES = [
  { icon: Zap, text: "Real-time messages, typing and read receipts" },
  { icon: MessagesSquare, text: "One-to-one and group conversations" },
  { icon: Lock, text: "Private by default — you control who sees what" },
];

export function AuthLayout() {
  return (
    <div className="h-app flex overflow-y-auto bg-bg">
      <aside className="relative hidden w-[44%] max-w-xl shrink-0 flex-col justify-between overflow-hidden bg-primary p-10 text-white lg:flex">
        <span className="inline-flex items-center gap-2.5 text-xl font-bold">
          <svg viewBox="0 0 32 32" className="size-9" aria-hidden>
            <rect width="32" height="32" rx="9" fill="#fff" fillOpacity=".16" />
            <path d="M8.5 12a4 4 0 0 1 4-4h7a4 4 0 0 1 4 4v4.5a4 4 0 0 1-4 4H15l-4.4 3.4c-.7.5-1.6 0-1.6-.8v-2.9a4 4 0 0 1-.5-2z" fill="#fff" />
          </svg>
          ChatApp
        </span>

        <div aria-hidden className="flex flex-col gap-3 py-12">
          <div className="max-w-[75%] self-start rounded-2xl rounded-bl-md bg-white/95 px-4 py-2.5 text-[15px] text-slate-900 shadow-lg">
            Are we still on for tonight?
          </div>
          <div className="max-w-[75%] self-end rounded-2xl rounded-br-md bg-white/20 px-4 py-2.5 text-[15px] shadow-lg backdrop-blur">
            Yes! See you at 8 🎉
          </div>
          <div className="self-end pr-1 text-xs text-white/70">Read 20:14</div>
        </div>

        <div>
          <h1 className="text-3xl leading-tight font-bold">Conversations that feel instant.</h1>
          <ul className="mt-6 flex flex-col gap-3 text-white/90">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <Icon className="size-5 shrink-0" /> {text}
              </li>
            ))}
          </ul>
        </div>
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-white/10 blur-2xl" />
      </aside>

      <main className="flex min-h-full flex-1 flex-col items-center justify-center px-5 py-10 pt-safe">
        <div className="w-full max-w-sm">
          <Logo className="mb-10 lg:hidden" />
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export function AuthHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-7">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
    </div>
  );
}

export function FormAlert({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
      {message}
    </div>
  );
}
