-- DispatchAI Database Initialization Script
-- This script sets up the initial database schema with pgvector extension

-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Create schema for dispatchai
CREATE SCHEMA IF NOT EXISTS dispatchai;

-- Set search path to include our schema
SET search_path TO dispatchai, public;

-- Issues table - stores raw GitHub issues
CREATE TABLE IF NOT EXISTS issues (
    id BIGSERIAL PRIMARY KEY,
    github_issue_id BIGINT UNIQUE NOT NULL,
    repository_name VARCHAR(255) NOT NULL,
    repository_owner VARCHAR(255) NOT NULL,
    issue_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    state VARCHAR(20) NOT NULL DEFAULT 'open',
    labels JSONB DEFAULT '[]',
    assignees JSONB DEFAULT '[]',
    author VARCHAR(255),
    author_association VARCHAR(50), -- 'OWNER', 'COLLABORATOR', 'CONTRIBUTOR', etc.
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    closed_at TIMESTAMP WITH TIME ZONE,
    raw_data JSONB NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(repository_owner, repository_name, issue_number)
);

-- Enriched issues table - stores AI-processed issue data
CREATE TABLE IF NOT EXISTS enriched_issues (
    id BIGSERIAL PRIMARY KEY,
    issue_id BIGINT REFERENCES issues(id) ON DELETE CASCADE,
    classification JSONB NOT NULL, -- {type, priority, component, sentiment, etc.}
    summary TEXT,
    tags TEXT[] DEFAULT '{}',
    suggested_assignees TEXT[] DEFAULT '{}',
    estimated_effort VARCHAR(20), -- 'low', 'medium', 'high', 'very_high'
    category VARCHAR(50), -- 'bug', 'feature', 'documentation', 'question', etc.
    priority VARCHAR(20), -- 'low', 'medium', 'high', 'urgent'
    severity VARCHAR(20), -- 'minor', 'major', 'critical', 'blocker'
    component VARCHAR(100), -- 'frontend', 'backend', 'api', 'database', etc.
    sentiment VARCHAR(20), -- 'positive', 'neutral', 'negative'
    embedding vector(1536), -- OpenAI ada-002 embedding dimension
    confidence_score DECIMAL(5,4) CHECK (confidence_score >= 0 AND confidence_score <= 1),
    processing_model VARCHAR(100),
    ai_reasoning TEXT, -- Store AI's reasoning for transparency
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Manual corrections table - stores human feedback for AI improvements
CREATE TABLE IF NOT EXISTS manual_corrections (
    id BIGSERIAL PRIMARY KEY,
    enriched_issue_id BIGINT REFERENCES enriched_issues(id) ON DELETE CASCADE,
    field_name VARCHAR(100) NOT NULL, -- e.g., 'classification.type', 'priority'
    original_value JSONB,
    corrected_value JSONB,
    corrected_by VARCHAR(255),
    correction_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Similar issues table - stores similarity relationships
CREATE TABLE IF NOT EXISTS similar_issues (
    id BIGSERIAL PRIMARY KEY,
    issue_id BIGINT REFERENCES enriched_issues(id) ON DELETE CASCADE,
    similar_issue_id BIGINT REFERENCES enriched_issues(id) ON DELETE CASCADE,
    similarity_score DECIMAL(5,4) CHECK (similarity_score >= 0 AND similarity_score <= 1),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(issue_id, similar_issue_id),
    CHECK (issue_id != similar_issue_id)
);

-- Processing logs table - for monitoring and debugging
CREATE TABLE IF NOT EXISTS processing_logs (
    id BIGSERIAL PRIMARY KEY,
    issue_id BIGINT REFERENCES issues(id) ON DELETE CASCADE,
    stage VARCHAR(50) NOT NULL, -- 'ingress', 'classification', 'enrichment'
    status VARCHAR(20) NOT NULL, -- 'success', 'error', 'retry'
    message TEXT,
    error_details JSONB,
    processing_time_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_issues_github_id ON issues(github_issue_id);
CREATE INDEX IF NOT EXISTS idx_issues_repo ON issues(repository_owner, repository_name);
CREATE INDEX IF NOT EXISTS idx_issues_created_at ON issues(created_at);
CREATE INDEX IF NOT EXISTS idx_issues_state ON issues(state);

CREATE INDEX IF NOT EXISTS idx_enriched_issues_issue_id ON enriched_issues(issue_id);
CREATE INDEX IF NOT EXISTS idx_enriched_issues_classification ON enriched_issues USING GIN(classification);
CREATE INDEX IF NOT EXISTS idx_enriched_issues_tags ON enriched_issues USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_enriched_issues_processed_at ON enriched_issues(processed_at);

-- Vector similarity search index (HNSW for better performance)
CREATE INDEX IF NOT EXISTS idx_enriched_issues_embedding ON enriched_issues
USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_manual_corrections_enriched_issue_id ON manual_corrections(enriched_issue_id);
CREATE INDEX IF NOT EXISTS idx_manual_corrections_field_name ON manual_corrections(field_name);

CREATE INDEX IF NOT EXISTS idx_similar_issues_issue_id ON similar_issues(issue_id);
CREATE INDEX IF NOT EXISTS idx_similar_issues_similarity_score ON similar_issues(similarity_score DESC);

CREATE INDEX IF NOT EXISTS idx_processing_logs_issue_id ON processing_logs(issue_id);
CREATE INDEX IF NOT EXISTS idx_processing_logs_stage_status ON processing_logs(stage, status);
CREATE INDEX IF NOT EXISTS idx_processing_logs_created_at ON processing_logs(created_at);

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_enriched_issues_updated_at
    BEFORE UPDATE ON enriched_issues
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert some sample data for testing (optional)
-- This can be removed in production
INSERT INTO issues (
    github_issue_id, repository_name, repository_owner, issue_number,
    title, body, state, labels, author, author_association, created_at, updated_at, raw_data
) VALUES 
(
    1, 'dispatchai', 'ascherj', 1,
    'App crashes on startup with npm start', 
    'When I run npm start, I get the following error:\n\nError: Cannot find module ''./config''\n\nThis happens consistently on macOS with Node.js 18.x. The error prevents the development server from starting.',
    'open', '["bug"]', 'contributor-user', 'CONTRIBUTOR',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '{"sample": true, "event": "opened"}'
),
(
    2, 'dispatchai', 'ascherj', 2,
    'Add dark mode support to dashboard',
    'It would be great to have a dark mode toggle in the dashboard. This would improve user experience, especially for developers working in low-light environments.\n\nSuggested implementation:\n- Toggle button in header\n- Save preference in localStorage\n- CSS variables for theme switching',
    'open', '["enhancement", "ui"]', 'external-contributor', 'FIRST_TIME_CONTRIBUTOR',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '{"sample": true, "event": "opened"}'
),
(
    3, 'auto-triager', 'ascherj', 3,
    'Update README with installation instructions',
    'The README is missing clear installation instructions. New contributors need step-by-step setup guide.',
    'open', '["documentation", "good-first-issue"]', 'maintainer', 'OWNER',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '{"sample": true, "event": "opened"}'
)
ON CONFLICT (repository_owner, repository_name, issue_number) DO NOTHING;

-- Grant permissions (adjust as needed for your security requirements)
GRANT USAGE ON SCHEMA dispatchai TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA dispatchai TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA dispatchai TO postgres;

-- Print success message
DO $$
BEGIN
    RAISE NOTICE 'DispatchAI database initialization completed successfully!';
    RAISE NOTICE 'Created tables: issues, enriched_issues, manual_corrections, similar_issues, processing_logs';
    RAISE NOTICE 'Enabled pgvector extension for similarity search';
END $$;
