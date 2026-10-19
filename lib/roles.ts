/** Someone who gets drive sheets: every driver, plus managers marked "Also drives". */
export const isDriver = (p: { role: string; drives?: boolean | null }) => p.role === "driver" || !!p.drives;
