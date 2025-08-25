"use client";

import { useState, useRef } from "react";
import pLimit from "p-limit";

interface Progress {
  processed: number;
  fetched: number;
}

interface ScrapeResult {
  url: string;
  companyName: string | null;
  data: {
    emails: string[];
    phones: string[];
    social: Record<string, string>;
  };
}

export default function Home() {
  const [urls, setUrls] = useState("");
  const [results, setResults] = useState<ScrapeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<Progress>({ processed: 0, fetched: 0 });

  const processedCountRef = useRef(0);
  const tempResultsRef = useRef<ScrapeResult[]>([]);

  const handleScrape = async () => {
    const urlList = urls
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);
    if (!urlList.length) return;

    setLoading(true);
    setResults([]);
    setProgress({ processed: 0, fetched: 0 });
    processedCountRef.current = 0;
    tempResultsRef.current = [];

    const limit = pLimit(5); // concurrency limit

    const tasks = urlList.map((url) =>
      limit(async () => {
        try {
          const res = await fetch("/api/scrape", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ urls: [url] }),
          });
          const data = await res.json();

          if (data.results && data.results.length) {
            tempResultsRef.current.push(...data.results);
          }
        } catch (err) {
          console.warn(`Failed to scrape ${url}`, err);
        } finally {
          processedCountRef.current++;
          setProgress({
            processed: processedCountRef.current,
            fetched: tempResultsRef.current.length,
          });
          setResults([...tempResultsRef.current]);
        }
      })
    );

    await Promise.all(tasks);
    setLoading(false);
  };

  const handleDownloadJSON = () => {
    if (!results.length) return;
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "scrape-results.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-8 bg-gray-50 min-h-screen flex flex-col items-center">
      <h1 className="text-3xl font-bold mb-6 text-center text-blue-700">Vercel Bulk Web Scraper</h1>

      <textarea
        rows={6}
        placeholder="Enter one URL per line"
        value={urls}
        onChange={(e) => setUrls(e.target.value)}
        className="w-full max-w-3xl p-4 border rounded-lg mb-4 resize-none focus:outline-blue-500"
      />

      <div className="flex flex-wrap gap-4 mb-4">
        <button
          onClick={handleScrape}
          disabled={loading || !urls.trim()}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
        >
          {loading ? "Scraping..." : "Start Scraping"}
        </button>
        <button
          onClick={handleDownloadJSON}
          disabled={!results.length}
          className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition"
        >
          Download JSON
        </button>
      </div>

      {progress.processed > 0 && (
        <div className="mb-4 text-gray-700">
          Processed: {progress.processed} / {urls.split("\n").filter(Boolean).length} | Fetched:{" "}
          {progress.fetched}
        </div>
      )}

      {results.length > 0 && (
        <pre className="bg-white p-4 rounded-lg overflow-auto max-h-96 w-full max-w-3xl shadow-sm">
          {JSON.stringify(results, null, 2)}
        </pre>
      )}
    </div>
  );
}
