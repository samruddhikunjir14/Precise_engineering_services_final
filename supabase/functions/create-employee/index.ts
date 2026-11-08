// Supabase Edge Function: create-employee
// Deploy this function in Supabase. Never put the service-role key in browser code.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://samruddhikunjir14.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return response({ error: "Server configuration is incomplete." }, 500);
  }

  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return response({ error: "Sign in as an administrator first." }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) return response({ error: "Your session is invalid. Please sign in again." }, 401);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Verify the caller's admin role using the trusted server-side client.
  const { data: callerRole, error: roleError } = await adminClient
    .from("user_roles")
    .select("role")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (roleError) return response({ error: "Could not verify administrator access." }, 500);
  if (callerRole?.role !== "admin") return response({ error: "Administrator access required." }, 403);

  let input: Record<string, unknown>;
  try {
    input = await req.json();
  } catch {
    return response({ error: "Request body must be valid JSON." }, 400);
  }

  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const fullName = typeof input.full_name === "string" ? input.full_name.trim() : "";
  const employeeCode = typeof input.employee_code === "string" ? input.employee_code.trim().toUpperCase() : "";
  const department = typeof input.department === "string" ? input.department.trim() : null;
  const designation = typeof input.designation === "string" ? input.designation.trim() : null;
  const joiningDate = typeof input.joining_date === "string" && input.joining_date.trim() ? input.joining_date.trim() : null;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response({ error: "Enter a valid employee email address." }, 400);
  if (fullName.length < 2 || fullName.length > 120) return response({ error: "Enter an employee name between 2 and 120 characters." }, 400);
  if (!/^[A-Z0-9_-]{2,30}$/.test(employeeCode)) return response({ error: "Employee ID must be 2–30 letters, numbers, hyphens or underscores." }, 400);
  if (department && department.length > 80) return response({ error: "Department is too long." }, 400);
  if (designation && designation.length > 80) return response({ error: "Designation is too long." }, 400);
  if (joiningDate && !/^\d{4}-\d{2}-\d{2}$/.test(joiningDate)) return response({ error: "Joining date must use YYYY-MM-DD format." }, 400);

  const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: "https://samruddhikunjir14.github.io/Precise_engineering_services_final/employee/login.html",
    data: { full_name: fullName, employee_code: employeeCode },
  });
  if (inviteError || !inviteData.user) {
    return response({ error: inviteError?.message || "Could not create the employee invitation." }, 400);
  }

  const employeeUserId = inviteData.user.id;
  const { error: roleInsertError } = await adminClient
    .from("user_roles")
    .insert({ user_id: employeeUserId, role: "employee" });

  if (roleInsertError) {
    await adminClient.auth.admin.deleteUser(employeeUserId);
    return response({ error: "Employee account was rolled back because the role could not be saved." }, 500);
  }

  const { error: employeeInsertError } = await adminClient
    .from("employees")
    .insert({
      id: employeeUserId,
      employee_code: employeeCode,
      full_name: fullName,
      department,
      designation,
      joining_date: joiningDate,
      is_active: true,
    });

  if (employeeInsertError) {
    await adminClient.from("user_roles").delete().eq("user_id", employeeUserId);
    await adminClient.auth.admin.deleteUser(employeeUserId);
    const duplicate = employeeInsertError.code === "23505";
    return response({
      error: duplicate
        ? "That employee ID is already in use. Choose a different employee ID."
        : "Employee profile could not be saved; the new account was rolled back.",
    }, 400);
  }

  return response({
    success: true,
    message: "Employee invitation sent. Ask the employee to open the email and set their password.",
    employee: { id: employeeUserId, employee_code: employeeCode, full_name: fullName, email },
  }, 201);
});
