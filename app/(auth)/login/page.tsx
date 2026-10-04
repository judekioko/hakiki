import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/components/forms";
import { getSession } from "@/lib/session";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  if (await getSession()) redirect("/app");
  const { from } = await searchParams;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <LoginForm from={from} />
        <p className="text-center text-sm text-slate-500">
          New here?{" "}
          <Link href="/signup" className="font-medium text-teal-700 hover:underline">
            Create a free account
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}
