require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || "5432", 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Simple API Key Auth Middleware
const API_KEY = process.env.API_KEY || "default-api-key-change-this";
function authMiddleware(req, res, next) {
  const key = req.headers["x-api-key"];
  if (!key || key !== API_KEY) {
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized: Invalid API Key" });
  }
  next();
}

const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function sanitizeText(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "API is up" });
});

app.get("/api/load", authMiddleware, async (req, res) => {
  try {
    const { limit = 2000 } = req.query;
    const sql = `SELECT id, nop, nama_op, status, luas, foto_url, jenis, rt, rw, jpb, nama_personel, keterangan, ST_AsGeoJSON(geom, 6) as geojson
                 FROM data_spasial
                 ORDER BY tanggal DESC
                 LIMIT $1`;
    const { rows } = await pool.query(sql, [parseInt(limit, 10)]);
    const data = rows.map((r) => ({
      ...r,
      geometry: JSON.parse(r.geojson),
      geojson: undefined,
    }));
    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/api/search", authMiddleware, async (req, res) => {
  try {
    const { nop, nama } = req.query;
    if (!nop && !nama) {
      return res.status(400).json({
        success: false,
        message: "Harus menyertakan query ?nop=... atau ?nama=...",
      });
    }

    const params = [];
    let sql = `SELECT id, nop, nama_op, status, luas, foto_url, jenis, rt, rw, jpb, nama_personel, keterangan, ST_AsGeoJSON(geom, 6) as geojson
               FROM data_spasial `;

    if (nop) {
      sql += `WHERE nop = $1 ORDER BY tanggal DESC LIMIT 20`;
      params.push(nop);
    } else {
      sql += `WHERE LOWER(nama_op) LIKE LOWER($1) ORDER BY tanggal DESC LIMIT 20`;
      params.push(`%${nama}%`);
    }

    const { rows } = await pool.query(sql, params);
    const data = rows.map((r) => ({
      ...r,
      geometry: JSON.parse(r.geojson),
      geojson: undefined,
    }));
    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/save", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const {
      nop,
      nama_op,
      status,
      luas,
      rt,
      rw,
      jpb,
      nama_personel,
      keterangan,
      type,
      coords,
      fotoBase64,
    } = body;

    if (!nop || !type || !coords) {
      return res.status(400).json({
        success: false,
        message: "Field nop, type, dan coords wajib diisi.",
      });
    }

    let fotoUrl = "-";
    if (fotoBase64 && fotoBase64.startsWith("data:image")) {
      const match = fotoBase64.match(
        /^data:image\/(png|jpeg|jpg);base64,(.+)$/,
      );
      if (match) {
        const ext = match[1] === "jpeg" ? "jpg" : match[1];
        const data = match[2];
        const buffer = Buffer.from(data, "base64");
        const filename = `MDS_${nop}_${Date.now()}.${ext}`;
        const filepath = path.join(UPLOAD_DIR, filename);
        fs.writeFileSync(filepath, buffer);
        fotoUrl = `/uploads/${filename}`;
      }
    }

    const wkt = (() => {
      const c = typeof coords === "string" ? JSON.parse(coords) : coords;
      if (!c) return null;
      if (type === "MARKER" || type === "POINT")
        return `POINT(${c.lng} ${c.lat})`;
      const poly = Array.isArray(c[0]) ? c[0] : c;
      const pts = poly.map((p) => `${p.lng} ${p.lat}`).join(",");
      return `POLYGON((${pts},${poly[0].lng} ${poly[0].lat}))`;
    })();

    const sql = `INSERT INTO data_spasial (tanggal, jenis, nop, nama_op, status, foto_url, geom, luas, rt, rw, jpb, nama_personel, keterangan)
                 VALUES (NOW(), $1, $2, $3, $4, $5, ST_SetSRID(ST_GeomFromText($6), 4326), $7, $8, $9, $10, $11, $12)
                 ON CONFLICT (nop) DO UPDATE SET
                   nama_op = EXCLUDED.nama_op,
                   status = EXCLUDED.status,
                   foto_url = (CASE WHEN EXCLUDED.foto_url = '-' THEN data_spasial.foto_url ELSE EXCLUDED.foto_url END),
                   tanggal = NOW(),
                   geom = EXCLUDED.geom,
                   luas = EXCLUDED.luas,
                   rt = EXCLUDED.rt,
                   rw = EXCLUDED.rw,
                   jpb = EXCLUDED.jpb,
                   nama_personel = EXCLUDED.nama_personel,
                   keterangan = EXCLUDED.keterangan`;

    await pool.query(sql, [
      sanitizeText(type),
      sanitizeText(nop),
      sanitizeText(nama_op),
      sanitizeText(status),
      sanitizeText(fotoUrl),
      wkt,
      parseFloat(luas) || 0,
      sanitizeText(rt),
      sanitizeText(rw),
      sanitizeText(jpb),
      sanitizeText(nama_personel),
      sanitizeText(keterangan),
    ]);

    res.json({ success: true, message: "✅ Berhasil Sinkronisasi" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete("/api/delete", authMiddleware, async (req, res) => {
  try {
    const { nop } = req.query;
    if (!nop) {
      return res
        .status(400)
        .json({ success: false, message: "Parameter nop wajib disertakan." });
    }
    await pool.query("DELETE FROM data_spasial WHERE nop = $1", [nop]);
    res.json({ success: true, message: "🗑️ Data Dihapus!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/import", authMiddleware, async (req, res) => {
  try {
    const data = req.body;
    if (!Array.isArray(data)) {
      return res
        .status(400)
        .json({ success: false, message: "Body harus berupa array data." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const sql = `INSERT INTO data_spasial (tanggal, jenis, nop, nama_op, status, geom, luas, rt, rw, jpb, nama_personel, keterangan)
                   VALUES (NOW(), $1, $2, $3, 'Belum Ter-survei', ST_SetSRID(ST_GeomFromGeoJSON($4), 4326), $5, $6, $7, $8, $9, $10)
                   ON CONFLICT (nop) DO NOTHING`;
      for (const item of data) {
        await client.query(sql, [
          sanitizeText(item.jenis),
          sanitizeText(item.nop),
          sanitizeText(item.nama_op || ""),
          JSON.stringify(item.geometry),
          parseFloat(item.luas) || 0,
          sanitizeText(item.rt),
          sanitizeText(item.rw),
          sanitizeText(item.jpb),
          sanitizeText(item.nama_personel),
          sanitizeText(item.keterangan),
        ]);
      }
      await client.query("COMMIT");
      res.json({
        success: true,
        message: `✅ ${data.length} Data Kerja Berhasil Diimpor!`,
      });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/api/master", authMiddleware, async (req, res) => {
  try {
    const { nop } = req.query;
    if (!nop) {
      return res
        .status(400)
        .json({ success: false, message: "Parameter nop wajib disertakan." });
    }

    const sql = `SELECT nm_wp, jalan, rt, rw, jpb_v1, luas_bumi
                 FROM master_pjk
                 WHERE TRIM(nop) = TRIM($1)
                 LIMIT 1`;
    const { rows } = await pool.query(sql, [nop]);
    if (rows.length === 0) {
      return res.json({ success: true, data: { found: false } });
    }
    const r = rows[0];
    res.json({
      success: true,
      data: {
        found: true,
        nama_op: r.nm_wp || "",
        rt: r.rt || "",
        rw: r.rw || "",
        jpb: r.jpb_v1 || "",
        luas: r.luas_bumi || "0",
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/api/export", authMiddleware, async (req, res) => {
  try {
    const sql = `SELECT id, nop, nama_op, status, luas, foto_url, jenis, rt, rw, jpb, nama_personel, keterangan, ST_AsGeoJSON(geom, 6) as geojson
                 FROM data_spasial
                 ORDER BY tanggal DESC`;
    const { rows } = await pool.query(sql);
    const features = rows.map((r) => ({
      type: "Feature",
      geometry: JSON.parse(r.geojson),
      properties: {
        nop: r.nop,
        nama_op: r.nama_op,
        status: r.status,
        luas: r.luas,
        foto_url: r.foto_url,
        jenis: r.jenis,
        rt: r.rt,
        rw: r.rw,
        jpb: r.jpb,
        nama_personel: r.nama_personel,
        keterangan: r.keterangan,
      },
    }));
    const geojson = {
      type: "FeatureCollection",
      features,
    };
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="mds_export_${Date.now()}.geojson"`,
    );
    res.json(geojson);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.use("/uploads", express.static(UPLOAD_DIR));

const port = parseInt(process.env.PORT || "3000", 10);
app.listen(port, () => {
  console.log(`API berjalan di http://localhost:${port}`);
});
