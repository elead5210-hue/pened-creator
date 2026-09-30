import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import { loginUser } from "@/lib/auth/authClient";
import { ApiError } from "@/lib/curriculum/shared/apiClient";
import { useAuth } from "@/lib/auth/AuthContext";

/** Search params this route understands. `redirect` is the location the
 * user was sent here from (set by requireAuth's redirect() in
 * ../lib/auth/routeGuard.ts) - once login succeeds, the user is sent back
 * there instead of always landing on "/". */
interface LoginSearch {
  redirect?: string;
}

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Log in" },
      {
        name: "description",
        content: "Log in to your account.",
      },
    ],
  }),
  component: LoginPage,
});

const loginFormSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginFormSchema>;

const DEFAULT_VALUES: LoginFormValues = {
  email: "",
  password: "",
};

/**
 * Turns a loginUser failure into a short, human-readable message.
 * ApiError carries the server's own message for 4xx responses; anything
 * else (unreachable network, 5xx) falls back to a generic message rather
 * than surfacing raw status text. Invalid credentials are deliberately
 * given one generic message regardless of whether the email or password
 * was wrong, so the form never reveals which part was incorrect.
 */
function describeLoginError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) {
      return "Could not reach the server. Check your connection and try again.";
    }
    if (err.status === 401) {
      return "Incorrect email or password.";
    }
    if (err.status >= 400 && err.status < 500) {
      return err.message || "Please check your details and try again.";
    }
  }
  return "Something went wrong logging you in. Please try again.";
}

/**
 * /login route: an email/password form, validated with zod via
 * react-hook-form, that authenticates an existing account. On success,
 * redirects back to wherever the user was headed before being sent here
 * (the `redirect` search param, e.g. set by a protected route's
 * beforeLoad guard) - falling back to "/", the app's main authenticated
 * area, if there isn't one.
 */
function LoginPage() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const { user, loading, refresh } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);

  // If a session already exists (restored after a page refresh, or just
  // established by a successful login), skip the form and send the user
  // to where they were headed, preserving the `redirect` return-to path.
  useEffect(() => {
    if (!loading && user) {
      void navigate({ to: redirect || "/", replace: true });
    }
  }, [loading, user, redirect, navigate]);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const isSubmitting = form.formState.isSubmitting;

  async function onSubmit(values: LoginFormValues) {
    setSubmitError(null);
    try {
      await loginUser(values);
      // Sync AuthContext with the newly established server session so
      // the rest of the app (route guards, toolbar) sees the user.
      await refresh();
      await navigate({ to: redirect || "/" });
    } catch (err) {
      setSubmitError(describeLoginError(err));
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Log in</CardTitle>
          <CardDescription>Welcome back — enter your details to continue.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
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
                        autoComplete="current-password"
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
                {isSubmitting ? "Logging in..." : "Log in"}
              </Button>
            </form>
          </Form>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link to="/register" className="underline underline-offset-4">
              Create one
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
