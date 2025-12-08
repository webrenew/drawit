-- ============================================
-- TEMP IMAGES STORAGE BUCKET
-- For temporary image uploads in AI chat
-- Cleaned up daily by Trigger.dev task
-- ============================================

-- Note: Storage buckets must be created via Supabase Dashboard or CLI
-- Run this SQL in the Supabase SQL Editor:

-- Create the bucket (if using SQL editor)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'temp-images',
  'temp-images',
  true,  -- Public so AI can access via URL
  5242880,  -- 5MB limit
  ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================
-- STORAGE POLICIES
-- Allow authenticated users to upload, public read
-- ============================================

-- Allow authenticated users to upload images
CREATE POLICY "Authenticated users can upload temp images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'temp-images');

-- Allow public read access (so AI models can fetch the URL)
CREATE POLICY "Public can read temp images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'temp-images');

-- Allow authenticated users to delete their own uploads
CREATE POLICY "Users can delete own temp images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'temp-images' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow service role to delete any temp images (for cleanup task)
CREATE POLICY "Service role can delete temp images"
ON storage.objects FOR DELETE
TO service_role
USING (bucket_id = 'temp-images');

-- ============================================
-- TEMP IMAGES METADATA TABLE
-- Track uploads for cleanup scheduling
-- ============================================
CREATE TABLE IF NOT EXISTS public.temp_images (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  file_name TEXT,
  file_size INTEGER,
  mime_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours')
);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_temp_images_expires_at ON public.temp_images(expires_at);
CREATE INDEX IF NOT EXISTS idx_temp_images_user_id ON public.temp_images(user_id);

-- RLS for temp_images table
ALTER TABLE public.temp_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own temp images"
ON public.temp_images FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own temp images"
ON public.temp_images FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own temp images"
ON public.temp_images FOR DELETE
USING (auth.uid() = user_id);

