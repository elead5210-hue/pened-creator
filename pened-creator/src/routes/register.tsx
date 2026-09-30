import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { registerUser } from "@/lib/auth/authClient";
import { ApiError } from "@/lib/curriculum/shared/apiClient";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Register" },
      {
        name: "description",
        content: "Create a new account.",
      },
    ],
  }),
  component: RegisterPage,
});

/**
 * Registration form schema. Intentionally has no `type`/role field — every
 * account created through this form is a 'creator' account, decided
 * server-side. There is no UI here for the user to influence that.
 */
const registerFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type RegisterFormValues = z.infer<typeof registerFormSchema>;

const DEFAULT_VALUES: RegisterFormValues = {
  name: "",
  email: "",
  password: "",
};

/**
 * Turns a registerUser failure into a short, human-readable message.
 * ApiError carries the server's own message (e.g. "email already
 * registered") for 4xx responses; anything else (unreachable network,
 * 5xx) falls back to a generic message rather than surfacing raw
 * status text.
 */
function describeRegisterError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) {
      return "Could not reach the server. Check your connection and try again.";
    }
    if (err.status === 409) {
      return "An account with that email already exists.";
    }
    if (err.status >= 400 && err.status < 500) {
      return err.message || "Please check your details and try again.";
    }
  }
  return "Something went wrong creating your account. Please try again.";
}

/**
 * /register route: a name/email/password form, validated with zod via
 * react-hook-form, that creates a new account. There is no role/type
 * selector anywhere on this page — every account created here is a
 * 'creator' account, which the server decides unconditionally. On
 * success, redirects to "/".
 */
function RegisterPage() {
  const navigate = useNavigate();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const isSubmitting = form.formState.isSubmitting;

  async function onSubmit(values: RegisterFormValues) {
    setSubmitError(null);
    try {
      await registerUser(values);
      await navigate({ to: "/" });
    } catch (err) {
      setSubmitError(describeRegisterError(err));
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create an account</CardTitle>
          <CardDescription>Sign up to start building curriculum.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input autoComplete="name" placeholder="Ada Lovelace" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        autoComplete="email"
                        placeholder="ada@example.com"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        placeholder="********"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {submitError ? (
                <p role="alert" className="text-sm text-destructive">
                  {submitError}
                </p>
              ) : null}

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? "Creating account..." : "Create account"}
              </Button>
            </form>
          </Form>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link to="/" className="underline underline-offset-4">
              Go home
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
