-- Migration: Track LINE users and groups when bot is added as friend or joins a group
-- Description: Store user_id on follow, group_id on join; mark inactive on unfollow/leave.
-- Reminders are sent to all active tracked users and groups.

-- Users who have added the bot as a friend (follow event)
CREATE TABLE IF NOT EXISTS line_users (
    id BIGSERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL UNIQUE,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_line_users_user_id ON line_users(user_id);
CREATE INDEX IF NOT EXISTS idx_line_users_active ON line_users(active);

-- Groups the bot has joined (join event)
CREATE TABLE IF NOT EXISTS line_groups (
    id BIGSERIAL PRIMARY KEY,
    group_id VARCHAR(255) NOT NULL UNIQUE,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_line_groups_group_id ON line_groups(group_id);
CREATE INDEX IF NOT EXISTS idx_line_groups_active ON line_groups(active);

-- Drop triggers if they exist (idempotent re-run)
DROP TRIGGER IF EXISTS update_line_users_updated_at ON line_users;
DROP TRIGGER IF EXISTS update_line_groups_updated_at ON line_groups;

CREATE TRIGGER update_line_users_updated_at
BEFORE UPDATE ON line_users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_line_groups_updated_at
BEFORE UPDATE ON line_groups
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
