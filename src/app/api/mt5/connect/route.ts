import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Legacy MetaApi account provisioning is blocked. Use the verified local MT5 bridge.", blocked: true },
    { status: 410 },
  );
}
