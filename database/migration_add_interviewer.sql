-- Migration: Add interviewer field to interviews table
-- Date: 2025-09-07
-- Description: Add 面談者 (interviewer) field to support interviewer information

-- Add the new interviewer column
ALTER TABLE interviews 
ADD COLUMN IF NOT EXISTS interviewer_name VARCHAR(255);

-- Add comment for documentation
COMMENT ON COLUMN interviews.interviewer_name IS '面談者 - The person conducting the interview';

-- Drop existing function first (return type is changing)
DROP FUNCTION IF EXISTS get_user_interviews(character varying);

-- Recreate the function to include interviewer
CREATE OR REPLACE FUNCTION get_user_interviews(user_id_param VARCHAR(255))
RETURNS TABLE (
    id BIGINT,
    interviewee_name VARCHAR(255),
    interviewer_name VARCHAR(255),
    interview_date DATE,
    interview_time TIME,
    reason TEXT,
    reminder_24h_sent BOOLEAN,
    reminder_3h_sent BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        i.id, 
        i.interviewee_name, 
        i.interviewer_name,
        i.interview_date, 
        i.interview_time, 
        i.reason,
        i.reminder_24h_sent,
        i.reminder_3h_sent,
        i.created_at,
        i.updated_at
    FROM interviews i
    WHERE i.user_id = user_id_param
    ORDER BY i.interview_date ASC, i.interview_time ASC;
END;
$$ LANGUAGE plpgsql;

-- Create index for interviewer queries (optional but good for performance)
CREATE INDEX IF NOT EXISTS idx_interviews_interviewer 
ON interviews(interviewer_name);

-- Update existing records to have a default interviewer name if needed
-- This is optional - you can set a default value or leave NULL
-- UPDATE interviews SET interviewer_name = '未指定' WHERE interviewer_name IS NULL;
