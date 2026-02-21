const express = require("express");
const ffmpeg = require("fluent-ffmpeg");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.json({ limit: "10mb" }));

const TMP_DIR = "/tmp";

// ----------------------
// DOWNLOAD FILE
// ----------------------
async function downloadFile(url, filepath) {
  const writer = fs.createWriteStream(filepath);
  const response = await axios({
    url,
    method: "GET",
    responseType: "stream"
  });

  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

// ----------------------
// MERGE ROUTE
// ----------------------
app.post("/merge", async (req, res) => {
  try {
    const { video1, video2, audio } = req.body;

    if (!video1 || !video2 || !audio) {
      return res.status(400).json({
        error: "video1, video2 and audio are required"
      });
    }

    const id = uuidv4();

    const v1 = path.join(TMP_DIR, `${id}_v1.mp4`);
    const v2 = path.join(TMP_DIR, `${id}_v2.mp4`);
    const a1 = path.join(TMP_DIR, `${id}_a.mp3`);
    const concatList = path.join(TMP_DIR, `${id}_list.txt`);
    const mergedVideo = path.join(TMP_DIR, `${id}_merged.mp4`);
    const finalOutput = path.join(TMP_DIR, `${id}_final.mp4`);

    console.log("Downloading files...");

    await downloadFile(video1, v1);
    await downloadFile(video2, v2);
    await downloadFile(audio, a1);

    // ----------------------
    // STEP 1 — CONCAT VIDEOS (NO REENCODE)
    // ----------------------

    fs.writeFileSync(concatList, `file '${v1}'\nfile '${v2}'`);

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatList)
        .inputOptions(["-f concat", "-safe 0"])
        .outputOptions(["-c copy"])
        .save(mergedVideo)
        .on("end", resolve)
        .on("error", reject);
    });

    console.log("Videos concatenated");

    // ----------------------
    // STEP 2 — REMOVE VIDEO AUDIO + ADD MP3
    // ----------------------

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(mergedVideo)
        .input(a1)
        .outputOptions([
          "-map 0:v:0",   // only video stream
          "-map 1:a:0",   // only mp3 audio
          "-c:v copy",    // no video re-encode
          "-c:a aac",
          "-shortest"
        ])
        .save(finalOutput)
        .on("end", resolve)
        .on("error", reject);
    });

    console.log("Final video ready");

    res.json({
      success: true,
      id,
      downloadUrl: `/download/${id}`
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------
// DOWNLOAD ROUTE
// ----------------------
app.get("/download/:id", (req, res) => {
  const filePath = path.join(TMP_DIR, `${req.params.id}_final.mp4`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  res.download(filePath, () => {
    fs.unlinkSync(filePath);
  });
});

// ----------------------
// HEALTH CHECK
// ----------------------
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// ----------------------
// START SERVER
// ----------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
