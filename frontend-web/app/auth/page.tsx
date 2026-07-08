import AuthFormPage from "./page-client";

type AuthPageProps = {
  searchParams?: {
    mode?: string;
  };
};

export default function AuthPage({ searchParams }: AuthPageProps) {
  const initialMode = searchParams?.mode === "register" ? "register" : "login";
  return <AuthFormPage initialMode={initialMode} />;
}
