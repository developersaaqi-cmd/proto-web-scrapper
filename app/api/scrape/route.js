import { load } from "cheerio";
import { parsePhoneNumberFromString } from "libphonenumber-js";

// ---------------- Helpers ----------------
const validTlds = [
  "com", "net", "org", "io", "ai", "co", "edu", "gov", "de", "uk", "ca", "in", "au", "jp",
  "us", "fr", "it", "es", "nl", "ru", "ch", "se", "no", "fi", "br", "cn", "za", "kr"
];

function getPrimaryEmail(emails) {
  emails = [...new Set(emails.map(e => e.toLowerCase()))]
    .map(e => e.split("?")[0].trim())
    .filter(e => !e.endsWith(".png") && !e.endsWith(".jpg") && e.includes("@"));

  // filter invalid TLDs
  emails = emails.filter(email => {
    const parts = email.split(".");
    const tld = parts[parts.length - 1].toLowerCase();
    return validTlds.includes(tld);
  });

  const priority = ["info@", "contact@", "support@"];
  for (let p of priority) {
    const found = emails.find(e => e.startsWith(p));
    if (found) return found;
  }
  return emails[0] || null;
}

function filterValidPhones(phones) {
  const valid = [];
  phones.forEach(p => {
    try {
      const phoneObj = parsePhoneNumberFromString(p, "ZZ");
      if (phoneObj && phoneObj.isValid()) valid.push(phoneObj.formatInternational());
    } catch {}
  });
  return [...new Set(valid)];
}

function getCompanyNameFromUrl(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const name = hostname.split(".")[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return null;
  }
}

// ---------------- Extract emails, phones, social ----------------
function extractDataFromHtml(html) {
  const $ = load(html);
  const result = { emails: [], phones: [], social: {} };

  $("body *").each((_, el) => {
    const element = $(el);
    const text = element.text() || "";
    const href = element.attr("href") || "";

    // Emails
    if (href.startsWith("mailto:")) result.emails.push(href.replace("mailto:", "").trim());
    const emails = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi);
    if (emails) result.emails.push(...emails);

    // Phones
    if (href.startsWith("tel:")) result.phones.push(href.replace("tel:", "").trim());
    else {
      const phones = text.match(/(\+?\d[\d\s\-()]{6,})/g);
      if (phones) result.phones.push(...phones.map(p => p.trim()));
    }

    // Social links
    if (href && /facebook\.com/i.test(href) && !/sharer\.php/i.test(href) && !/\?/.test(href))
      result.social.facebook = href;
    if (href && /instagram\.com/i.test(href) && !/\?/.test(href)) result.social.instagram = href;
    if (
      href &&
      /linkedin\.com/i.test(href) &&
      !/shareArticle/i.test(href) &&
      /linkedin\.com\/(company|in)\//i.test(href)
    )
      result.social.linkedin = href;
  });

  return result;
}

// ---------------- Scrape a single URL ----------------
async function scrapeUrl(url) {
  const results = [];
  let data = { emails: [], phones: [], social: {} };

  try {
    // Fetch homepage
    const res = await fetch(url, { timeout: 15000 });
    const html = await res.text();
    const homepageData = extractDataFromHtml(html);
    data.emails.push(...homepageData.emails);
    data.phones.push(...homepageData.phones);
    data.social = { ...data.social, ...homepageData.social };

    // Try /contact/ page
    const contactUrl = url.endsWith("/") ? url + "contact/" : url + "/contact/";
    try {
      const contactRes = await fetch(contactUrl, { timeout: 15000 });
      const contactHtml = await contactRes.text();
      const contactData = extractDataFromHtml(contactHtml);
      data.emails.push(...contactData.emails);
      data.phones.push(...contactData.phones);
      data.social = { ...data.social, ...contactData.social };
    } catch {}
  } catch {}

  // Deduplicate & validate
  const primaryEmail = getPrimaryEmail(data.emails);
  data.emails = primaryEmail ? [primaryEmail] : [];
  data.phones = filterValidPhones(data.phones).slice(0, 1);

  if (data.social.linkedin) {
    const match = data.social.linkedin.match(/(https?:\/\/www\.linkedin\.com\/company\/[a-zA-Z0-9-_]+)/i);
    if (match) data.social.linkedin = match[1];
  }

  const companyName = getCompanyNameFromUrl(url);

  if (
    (data.emails && data.emails.length) ||
    (data.phones && data.phones.length) ||
    (data.social && Object.keys(data.social).length)
  ) {
    results.push({ url, companyName, data });
  }

  return results;
}

// ---------------- API Route ----------------
export async function POST(req) {
  try {
    const { urls } = await req.json();
    if (!urls || !Array.isArray(urls) || urls.length === 0)
      return new Response(JSON.stringify({ error: "URLs array is required" }), { status: 400 });

    const allResults = [];
    for (const url of urls) {
      const res = await scrapeUrl(url);
      allResults.push(...res);
    }

    return new Response(JSON.stringify({ results: allResults }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
