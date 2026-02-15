/**
 * 이미지 버킷 마이그레이션 스크립트
 * media-products → products 버킷으로 모든 이미지 복사
 */

import { createClient } from '@supabase/supabase-js';

// Supabase configuration
const SUPABASE_URL = 'https://zafxzidbtbryiksemlwc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphZnh6aWRidGJyeWlrc2VtbHdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY3MTU1NzIsImV4cCI6MjA4MjI5MTU3Mn0.DEylxIGynOxzUC-mt5HwJt1gWOqG400QejvKxLdghhw';

const OLD_BUCKET = 'media-products';
const NEW_BUCKET = 'products';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * List all files in a bucket (with pagination)
 */
async function listAllFiles(bucket, folder = '') {
    const allFiles = [];
    let offset = 0;
    const limit = 100;

    while (true) {
        const { data, error } = await supabase.storage
            .from(bucket)
            .list(folder, {
                limit,
                offset,
            });

        if (error) {
            console.error(`Error listing files in ${bucket}/${folder}:`, error.message);
            break;
        }

        if (!data || data.length === 0) break;

        // Filter out folders (they have null id) and add to list
        for (const item of data) {
            if (item.id) {
                allFiles.push(folder ? `${folder}/${item.name}` : item.name);
            } else {
                // It's a folder, recurse into it
                const subFiles = await listAllFiles(bucket, folder ? `${folder}/${item.name}` : item.name);
                allFiles.push(...subFiles);
            }
        }

        offset += limit;
        if (data.length < limit) break;
    }

    return allFiles;
}

/**
 * Copy a single file between buckets
 */
async function copyFile(filePath) {
    try {
        // Download from old bucket
        const { data: fileData, error: downloadError } = await supabase.storage
            .from(OLD_BUCKET)
            .download(filePath);

        if (downloadError) {
            console.error(`Download error for ${filePath}:`, downloadError.message);
            return false;
        }

        // Convert to buffer
        const buffer = await fileData.arrayBuffer();

        // Upload to new bucket
        const { error: uploadError } = await supabase.storage
            .from(NEW_BUCKET)
            .upload(filePath, buffer, {
                contentType: fileData.type,
                upsert: true
            });

        if (uploadError) {
            console.error(`Upload error for ${filePath}:`, uploadError.message);
            return false;
        }

        return true;
    } catch (error) {
        console.error(`Error copying ${filePath}:`, error.message);
        return false;
    }
}

/**
 * Main execution
 */
async function main() {
    console.log("=".repeat(50));
    console.log("Image Bucket Migration: media-products → products");
    console.log("=".repeat(50));

    // Step 1: List all files in old bucket
    console.log("\nListing files in media-products bucket...");
    const files = await listAllFiles(OLD_BUCKET);
    console.log(`Found ${files.length} files to migrate`);

    if (files.length === 0) {
        console.log("No files to migrate.");
        return;
    }

    // Step 2: Copy each file
    console.log("\nStarting file migration...");
    let success = 0;
    let failed = 0;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        process.stdout.write(`\r[${i + 1}/${files.length}] Copying: ${file.substring(0, 50)}...`);

        const copied = await copyFile(file);
        if (copied) {
            success++;
        } else {
            failed++;
        }

        // Rate limiting
        await new Promise(r => setTimeout(r, 100));
    }

    console.log("\n\n" + "=".repeat(50));
    console.log("Migration Complete!");
    console.log(`- Success: ${success}`);
    console.log(`- Failed: ${failed}`);
    console.log("=".repeat(50));
}

main().catch(console.error);
