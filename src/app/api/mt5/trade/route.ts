import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Legacy MetaApi execution is blocked until secure native execution is implemented.", blocked: true },
    { status: 410 },
  );
}
