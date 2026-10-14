import { handle, HttpError, requireUser } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Address -> coordinates, for saving Home / Work / a custom end point. */
export const GET = handle(async (req) => {
  await requireUser(req);
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) throw new HttpError(400, "Type an address first.");
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) throw new HttpError(400, "Address search needs the Google Maps key. Use “Current location” for now.");
  const url = `https://maps.googleapis.com/maps/api/geocode/json?region=us&components=country:US&address=${encodeURIComponent(q)}&key=${key}`;
  const json: any = await (await fetch(url)).json();
  if (json.status !== "OK" || !json.results?.length) throw new HttpError(404, "Couldn't find that address. Try adding the city and ZIP.");
  return Response.json({
    results: json.results.slice(0, 4).map((r: any) => ({
      address: r.formatted_address, lat: r.geometry.location.lat, lng: r.geometry.location.lng,
    })),
  });
});
