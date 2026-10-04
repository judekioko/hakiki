import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { SignupForm } from "@/components/forms";
import { getSession } from "@/lib/session";

export const metadata = { title: "Create account" };

export default async function SignupPage() {
  if (await getSession()) redirect("/app");

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <p className="mt-1 text-sm text-slate-500">Accountants: start with your first client and add more later.</p>
      </CardHeader>
      <CardBody className="space-y-4">
        <SignupForm />
        <p className="text-center text-sm text-slate-500">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-teal-700 hover:underline">
            Sign in
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}
