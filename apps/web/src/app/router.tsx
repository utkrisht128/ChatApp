import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter } from "react-router";
import { Spinner } from "@/components/ui/Spinner";
import { GuestOnly, RequireAuth } from "@/features/auth/guards";
import { ChatsSection, NoChatSelected } from "@/features/chats/ChatsSection";
import { AppShell } from "@/layouts/AppShell";
import { AuthLayout } from "@/layouts/AuthLayout";
import { NotFoundPage, RouteError } from "./RouteError";

const LoginPage = lazy(() => import("@/features/auth/pages/LoginPage"));
const RegisterPage = lazy(() => import("@/features/auth/pages/RegisterPage"));
const ForgotPasswordPage = lazy(() => import("@/features/auth/pages/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("@/features/auth/pages/ResetPasswordPage"));
const VerifyEmailPage = lazy(() => import("@/features/auth/pages/VerifyEmailPage"));
const ConversationPage = lazy(() => import("@/features/conversation/ConversationPage"));
const AdminPage = lazy(() => import("@/features/admin/AdminPage"));

const settings = () => import("@/features/settings/SettingsPages");
const SettingsSection = lazy(() => settings().then((m) => ({ default: m.SettingsSection })));
const SettingsIndex = lazy(() => settings().then((m) => ({ default: m.SettingsIndex })));
const ProfileSettings = lazy(() => settings().then((m) => ({ default: m.ProfileSettings })));
const AccountSettings = lazy(() => settings().then((m) => ({ default: m.AccountSettings })));
const PrivacySettings = lazy(() => settings().then((m) => ({ default: m.PrivacySettings })));
const BlockedSettings = lazy(() => settings().then((m) => ({ default: m.BlockedSettings })));
const NotificationSettings = lazy(() => settings().then((m) => ({ default: m.NotificationSettings })));
const AppearanceSettings = lazy(() => settings().then((m) => ({ default: m.AppearanceSettings })));
const ChatSettings = lazy(() => settings().then((m) => ({ default: m.ChatSettings })));

function PaneLoader() {
  return (
    <div className="grid flex-1 place-items-center py-16 text-muted">
      <Spinner label="Loading" />
    </div>
  );
}

const s = (node: ReactNode) => <Suspense fallback={<PaneLoader />}>{node}</Suspense>;

export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      {
        element: <GuestOnly />,
        children: [
          {
            element: <AuthLayout />,
            children: [
              { path: "login", element: s(<LoginPage />) },
              { path: "register", element: s(<RegisterPage />) },
              { path: "forgot-password", element: s(<ForgotPasswordPage />) },
            ],
          },
        ],
      },
      // Reachable whether or not you're signed in (links arrive by email).
      {
        element: <AuthLayout />,
        children: [
          { path: "reset-password", element: s(<ResetPasswordPage />) },
          { path: "verify-email", element: s(<VerifyEmailPage />) },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              {
                element: <ChatsSection />,
                children: [
                  { index: true, element: <NoChatSelected /> },
                  { path: "c/:chatId", element: s(<ConversationPage />) },
                ],
              },
              { path: "admin", element: s(<AdminPage />) },
              {
                path: "settings",
                element: s(<SettingsSection />),
                children: [
                  { index: true, element: s(<SettingsIndex />) },
                  { path: "profile", element: s(<ProfileSettings />) },
                  { path: "account", element: s(<AccountSettings />) },
                  { path: "privacy", element: s(<PrivacySettings />) },
                  { path: "blocked", element: s(<BlockedSettings />) },
                  { path: "notifications", element: s(<NotificationSettings />) },
                  { path: "appearance", element: s(<AppearanceSettings />) },
                  { path: "chats", element: s(<ChatSettings />) },
                ],
              },
            ],
          },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
