import { describe, it, expect } from "vitest";

// ── Bounty calculation ────────────────────────────────────────────────

const CURRENCY_SYMBOLS: Record<string, string> = { EUR: "€", USD: "$", GBP: "£", CHF: "CHF" };

function fmt(amount: number, currency: string): string {
  return `${CURRENCY_SYMBOLS[currency] ?? currency}${amount.toFixed(2)}`;
}

function calcTotal(bookCount: number, pricePerBook: number): number {
  return Math.round(bookCount * pricePerBook * 100) / 100;
}

// ── Invite token helpers ──────────────────────────────────────────────

function isTokenExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}

function buildPaymentUrl(baseLink: string, amount: number): string {
  const note = encodeURIComponent("Libris indexing");
  return baseLink.includes("?")
    ? `${baseLink}&amount=${amount}&note=${note}`
    : `${baseLink}/${amount}`;
}

// ── ISBN normalisation (mirrors BarcodeScanner logic) ─────────────────

function normalizeIsbn(raw: string): string | null {
  const digits = raw.replace(/[^0-9Xx]/g, "");
  if (digits.length === 13 && (digits.startsWith("978") || digits.startsWith("979"))) return digits;
  if (digits.length === 10) return digits;
  return null;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("bounty calculation", () => {
  it("calculates total correctly", () => {
    expect(calcTotal(10, 0.50)).toBe(5.00);
    expect(calcTotal(1, 0.50)).toBe(0.50);
    expect(calcTotal(0, 0.50)).toBe(0);
    expect(calcTotal(37, 0.50)).toBe(18.50);
  });

  it("handles fractional prices without floating-point drift", () => {
    expect(calcTotal(3, 0.33)).toBe(0.99);
    expect(calcTotal(3, 0.10)).toBe(0.30);
  });
});

describe("currency formatting", () => {
  it("formats known currencies", () => {
    expect(fmt(5.00, "EUR")).toBe("€5.00");
    expect(fmt(12.50, "USD")).toBe("$12.50");
    expect(fmt(3.00, "GBP")).toBe("£3.00");
  });

  it("falls back to currency code for unknown currencies", () => {
    expect(fmt(10.00, "JPY")).toBe("JPY10.00");
  });

  it("always shows two decimal places", () => {
    expect(fmt(5, "EUR")).toBe("€5.00");
    expect(fmt(5.5, "EUR")).toBe("€5.50");
  });
});

describe("invite token expiry", () => {
  it("identifies expired tokens", () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    expect(isTokenExpired(yesterday)).toBe(true);
  });

  it("accepts valid (future) tokens", () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    expect(isTokenExpired(tomorrow)).toBe(false);
  });
});

describe("payment URL builder", () => {
  it("appends amount to PayPal.me URL", () => {
    const url = buildPaymentUrl("https://paypal.me/username", 10.50);
    expect(url).toBe("https://paypal.me/username/10.5");
  });

  it("uses query params for URLs that already have them", () => {
    const url = buildPaymentUrl("https://pay.example.com/pay?ref=123", 5.00);
    expect(url).toContain("amount=5");
    expect(url).toContain("ref=123");
  });
});

describe("ISBN normalisation", () => {
  it("accepts valid ISBN-13 starting with 978", () => {
    expect(normalizeIsbn("9780306406157")).toBe("9780306406157");
  });

  it("accepts valid ISBN-13 starting with 979", () => {
    expect(normalizeIsbn("9791032311066")).toBe("9791032311066");
  });

  it("accepts valid ISBN-10", () => {
    expect(normalizeIsbn("0306406152")).toBe("0306406152");
  });

  it("strips hyphens and spaces from barcodes", () => {
    expect(normalizeIsbn("978-0-306-40615-7")).toBe("9780306406157");
  });

  it("rejects invalid barcodes", () => {
    expect(normalizeIsbn("12345")).toBeNull();
    expect(normalizeIsbn("")).toBeNull();
    expect(normalizeIsbn("abcdefghij")).toBeNull();
  });

  it("rejects ISBN-13 not starting with 978 or 979", () => {
    expect(normalizeIsbn("1234567890123")).toBeNull();
  });
});
