const API_URL = "http://localhost:3000/api/board";

async function testFetch() {
  try {
    console.log("Fetching", API_URL);
    const response = await fetch(API_URL);
    console.log("Response status:", response.status);
    const data = await response.json();
    console.log("Data:", data);
  } catch (err) {
    console.error("Fetch failed:", err);
  }
}
testFetch();
