const $ = (id) => document.getElementById(id);

$("textInput").addEventListener("input", () => {
  $("charCount").textContent = $("textInput").value.length;
});

$("analyzeBtn").addEventListener("click", async () => {
  const text = $("textInput").value.trim();
  $("error").classList.add("hidden");
  $("result").classList.add("hidden");

  if (!text) return showError("Please enter text to analyze.");

  $("loader").classList.remove("hidden");
  $("analyzeBtn").disabled = true;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || "Server error");
    showResult(data);
  } catch (e) {
    showError("Unable to analyze the text at this time. Please try again.");
    console.error(e);
  } finally {
    $("loader").classList.add("hidden");
    $("analyzeBtn").disabled = false;
  }
});

function showError(msg) {
  $("error").textContent = msg;
  $("error").classList.remove("hidden");
}

function showResult(d) {
  const sentiment = d.sentiment || "Neutral";
  $("badge").textContent = sentiment;
  $("badge").className = "badge " + sentiment.toLowerCase();
  $("score").textContent = typeof d.score === "number" ? d.score.toFixed(2) : (d.score || "0.00");
  $("magnitude").textContent = typeof d.magnitude === "number" ? d.magnitude.toFixed(2) : (d.magnitude || "0.00");
  $("timestamp").textContent = d.timestamp ? new Date(d.timestamp).toLocaleString() : new Date().toLocaleString();
  $("result").classList.remove("hidden");
}
