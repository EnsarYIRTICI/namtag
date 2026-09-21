import { Readable } from "node:stream";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Config } from "./config";

export interface StoredObject {
  body: Readable;
  size?: number;
}

/** Nesne deposu arayüzü: MinIO yerine başka bir S3 uyumlu depo kullanmak için sadece yapılandırma değişir. */
export interface ObjectStore {
  ensureBucket(): Promise<void>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class S3Store implements ObjectStore {
  private client: S3Client;
  private bucket: string;

  constructor(cfg: Pick<Config, "S3_ENDPOINT" | "S3_REGION" | "S3_BUCKET" | "S3_ACCESS_KEY" | "S3_SECRET_KEY" | "S3_FORCE_PATH_STYLE">) {
    this.bucket = cfg.S3_BUCKET;
    this.client = new S3Client({
      endpoint: cfg.S3_ENDPOINT,
      region: cfg.S3_REGION,
      forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: cfg.S3_ACCESS_KEY, secretAccessKey: cfg.S3_SECRET_KEY },
      // Yeni SDK varsayılan olarak ek sağlama toplamı ekler; bazı S3 uyumlu depolar bunu sevmez.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  async ensureBucket(): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 15; attempt++) {
      try {
        try {
          await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
          return;
        } catch (e: any) {
          const status = e?.$metadata?.httpStatusCode;
          if (status !== 404 && e?.name !== "NotFound" && e?.name !== "NoSuchBucket") throw e;
        }
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        console.log(`Bucket oluşturuldu: ${this.bucket}`);
        return;
      } catch (e) {
        lastErr = e;
        console.warn(`Nesne deposuna ulaşılamadı (deneme ${attempt}/15): ${(e as Error).message}`);
        await sleep(2000);
      }
    }
    throw lastErr;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!r.Body) return null;
      return { body: r.Body as Readable, size: r.ContentLength };
    } catch (e: any) {
      if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
