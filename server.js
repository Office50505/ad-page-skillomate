const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const root = __dirname;
const otpChallenges = new Map();
const authSessions = new Map();

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readJson(request, callback) {
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
    if (body.length > 10_000) request.destroy();
  });
  request.on("end", () => {
    try {
      callback(null, JSON.parse(body || "{}"));
    } catch {
      callback(new Error("Invalid JSON"));
    }
  });
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
};

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function serveFile(request, response) {
  const requestPath = request.url === "/" ? "/index.html" : request.url.split("?")[0];
  const filePath = path.resolve(root, `.${decodeURIComponent(requestPath)}`);

  if (!filePath.startsWith(root + path.sep)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  if (path.extname(filePath) === ".mp4") {
    fs.stat(filePath, (error, stats) => {
      if (error) {
        response.writeHead(error.code === "ENOENT" ? 404 : 500);
        response.end(error.code === "ENOENT" ? "Not found" : "Server error");
        return;
      }

      const range = request.headers.range;
      if (!range) {
        response.writeHead(200, {
          "Content-Type": "video/mp4",
          "Content-Length": stats.size,
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=3600",
        });
        fs.createReadStream(filePath).pipe(response);
        return;
      }

      const [startText, endText] = range.replace("bytes=", "").split("-");
      const start = Number(startText);
      const end = endText ? Number(endText) : Math.min(start + 1_000_000, stats.size - 1);

      if (!Number.isFinite(start) || start < 0 || end >= stats.size || start > end) {
        response.writeHead(416, { "Content-Range": `bytes */${stats.size}` });
        response.end();
        return;
      }

      response.writeHead(206, {
        "Content-Type": "video/mp4",
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${stats.size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600",
      });
      fs.createReadStream(filePath, { start, end }).pipe(response);
    });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500);
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(data);
  });
}

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/api/health") {
    sendJson(response, 200, { ok: true, service: "skillo-mate-checkout" });
    return;
  }

  if (request.method === "POST" && request.url === "/api/auth/send-otp") {
    readJson(request, (error, payload) => {
      const phone = String(payload?.phone || "").replace(/\D/g, "");
      if (error || !/^[6-9]\d{9}$/.test(phone)) {
        sendJson(response, 400, { ok: false, message: "Enter a valid 10-digit mobile number." });
        return;
      }

      const challengeId = crypto.randomUUID();
      const otp = String(crypto.randomInt(100000, 1000000));
      otpChallenges.set(challengeId, {
        phone,
        otpHash: hash(otp),
        expiresAt: Date.now() + 5 * 60 * 1000,
        attempts: 0,
      });

      sendJson(response, 201, {
        ok: true,
        challengeId,
        expiresInSeconds: 300,
        demoOtp: otp,
      });
    });
    return;
  }

  if (request.method === "POST" && request.url === "/api/auth/verify-otp") {
    readJson(request, (error, payload) => {
      const challenge = otpChallenges.get(payload?.challengeId);
      if (error || !challenge) {
        sendJson(response, 400, { ok: false, message: "OTP session expired. Request a new code." });
        return;
      }
      if (Date.now() > challenge.expiresAt || challenge.attempts >= 5) {
        otpChallenges.delete(payload.challengeId);
        sendJson(response, 400, { ok: false, message: "OTP expired. Request a new code." });
        return;
      }

      challenge.attempts += 1;
      if (hash(String(payload?.otp || "")) !== challenge.otpHash) {
        sendJson(response, 400, { ok: false, message: "Incorrect OTP. Please try again." });
        return;
      }

      otpChallenges.delete(payload.challengeId);
      const authToken = crypto.randomUUID();
      authSessions.set(authToken, { phone: challenge.phone, expiresAt: Date.now() + 30 * 60 * 1000 });
      sendJson(response, 200, { ok: true, authToken });
    });
    return;
  }

  if (request.method === "POST" && request.url === "/api/payments") {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10_000) request.destroy();
    });
    request.on("end", () => {
      try {
        const payment = JSON.parse(body || "{}");
        const authToken = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
        const session = authSessions.get(authToken);
        if (!session || session.expiresAt < Date.now()) {
          sendJson(response, 401, { ok: false, message: "Please verify your phone number first." });
          return;
        }
        if (
          payment.planId !== "skillomate-monthly-trial" ||
          payment.amount !== 1 ||
          payment.renewalAmount !== 499
        ) {
          sendJson(response, 400, { ok: false, message: "Invalid payment details." });
          return;
        }

        sendJson(response, 201, {
          ok: true,
          status: "paid",
          planId: payment.planId,
          trialHours: 24,
          renewalAmount: 499,
          transactionId: `SKM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        });
      } catch {
        sendJson(response, 400, { ok: false, message: "Invalid request." });
      }
    });
    return;
  }

  if (request.method === "GET") {
    serveFile(request, response);
    return;
  }

  response.writeHead(405, { Allow: "GET, POST" });
  response.end("Method not allowed");
});

server.listen(port, host, () => {
  console.log(`Skillo Mate checkout running at http://${host}:${port}`);
});
