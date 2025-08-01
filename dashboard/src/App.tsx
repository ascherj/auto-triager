import { useState, useEffect } from 'react'
import './App.css'

interface Issue {
  id: number
  number: number
  title: string
  repository: string
  category?: string
  priority?: string
  confidence?: number
  tags: string[]
  created_at: string
  updated_at: string
  status: string
}

interface EditingIssue {
  id: number
  category: string
  priority: string
  tags: string
}

interface ClassificationUpdate {
  type: string
  data: {
    issue_id: number
    category: string
    priority: string
    confidence: number
    tags: string[]
  }
}

interface Stats {
  total_issues: number
  classified_issues: number
  pending_issues: number
  connected_clients: number
  categories: { name: string; count: number }[]
  priorities: { name: string; count: number }[]
}

function App() {
  const [issues, setIssues] = useState<Issue[]>([])
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected')
  const [stats, setStats] = useState<Stats | null>(null)
  const [editingIssue, setEditingIssue] = useState<EditingIssue | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    let ws: WebSocket | null = null
    let reconnectTimeout: NodeJS.Timeout | null = null
    let reconnectAttempts = 0
    const maxReconnectAttempts = 5
    const reconnectInterval = 3000 // 3 seconds

    const connectWebSocket = () => {
      const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8002/ws'
      
      setConnectionStatus('connecting')
      ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        setConnectionStatus('connected')
        reconnectAttempts = 0
        console.log('Connected to WebSocket')
      }

      ws.onmessage = (event) => {
        try {
          const message: ClassificationUpdate = JSON.parse(event.data)

          if (message.type === 'classification_update') {
            // Update the issue in the list
            setIssues(prev => prev.map(issue =>
              issue.id === message.data.issue_id
                ? {
                    ...issue,
                    category: message.data.category,
                    priority: message.data.priority,
                    confidence: message.data.confidence,
                    tags: message.data.tags,
                    status: 'classified'
                  }
                : issue
            ))
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error)
        }
      }

      ws.onclose = (event) => {
        setConnectionStatus('disconnected')
        console.log('WebSocket disconnected:', event.code, event.reason)
        
        // Attempt to reconnect if it wasn't a manual close and we haven't exceeded max attempts
        if (event.code !== 1000 && reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++
          console.log(`Attempting to reconnect... (${reconnectAttempts}/${maxReconnectAttempts})`)
          reconnectTimeout = setTimeout(connectWebSocket, reconnectInterval)
        } else if (reconnectAttempts >= maxReconnectAttempts) {
          console.log('Max reconnection attempts reached')
        }
      }

      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
        setConnectionStatus('disconnected')
      }
    }

    // Initial connection
    connectWebSocket()

    // Cleanup on unmount
    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout)
      }
      if (ws) {
        ws.close(1000, 'Component unmounting')
      }
    }
  }, [])

  useEffect(() => {
    // Fetch initial issues
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8002'
    fetch(`${apiUrl}/api/issues`)
      .then(res => res.json())
      .then(data => setIssues(data))
      .catch(error => console.error('Error fetching issues:', error))

    // Fetch stats
    fetch(`${apiUrl}/api/stats`)
      .then(res => res.json())
      .then(data => setStats(data))
      .catch(error => console.error('Error fetching stats:', error))
  }, [])

  const triggerClassification = async (issueId: number) => {
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8002'
      await fetch(`${apiUrl}/api/issues/${issueId}/classify`, {
        method: 'POST'
      })
    } catch (error) {
      console.error('Error triggering classification:', error)
    }
  }

  const startEditing = (issue: Issue) => {
    setEditingIssue({
      id: issue.id,
      category: issue.category || '',
      priority: issue.priority || '',
      tags: issue.tags.join(', ')
    })
  }

  const cancelEditing = () => {
    setEditingIssue(null)
  }

  const saveCorrection = async () => {
    if (!editingIssue) return
    
    setIsSubmitting(true)
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8002'
      const response = await fetch(`${apiUrl}/api/issues/${editingIssue.id}/correct`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          issue_id: editingIssue.id,
          category: editingIssue.category,
          priority: editingIssue.priority,
          tags: editingIssue.tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0)
        })
      })
      
      if (response.ok) {
        const updatedIssue = await response.json()
        setIssues(prev => prev.map(issue => 
          issue.id === editingIssue.id 
            ? { ...issue, ...updatedIssue, status: 'classified' }
            : issue
        ))
        setEditingIssue(null)
      } else {
        console.error('Failed to save correction')
      }
    } catch (error) {
      console.error('Error saving correction:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'classified': return '#22c55e'
      case 'pending': return '#f59e0b'
      default: return '#6b7280'
    }
  }

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'critical': return '#ef4444'
      case 'high': return '#f97316'
      case 'medium': return '#eab308'
      case 'low': return '#22c55e'
      default: return '#6b7280'
    }
  }

  return (
    <div className="App">
      <header className="header">
        <h1>🤖 DispatchAI Dashboard</h1>
        <div className="connection-status">
          <span className={`status-indicator ${connectionStatus}`}></span>
          <span>WebSocket: {connectionStatus}</span>
        </div>
      </header>

      {stats && (
        <div className="stats-grid">
          <div className="stat-card">
            <h3>Total Issues</h3>
            <p className="stat-number">{stats.total_issues}</p>
          </div>
          <div className="stat-card">
            <h3>Classified</h3>
            <p className="stat-number">{stats.classified_issues}</p>
          </div>
          <div className="stat-card">
            <h3>Pending</h3>
            <p className="stat-number">{stats.pending_issues}</p>
          </div>
          <div className="stat-card">
            <h3>Connected Clients</h3>
            <p className="stat-number">{stats.connected_clients}</p>
          </div>
        </div>
      )}

      {stats && (stats.categories.length > 0 || stats.priorities.length > 0) && (
        <div className="analytics-container">
          <h2>📊 Analytics</h2>
          <div className="charts-grid">
            {stats.categories.length > 0 && (
              <div className="chart-card">
                <h3>Categories</h3>
                <div className="chart">
                  {stats.categories.map((category) => {
                    const percentage = stats.total_issues > 0 ? (category.count / stats.total_issues) * 100 : 0
                    return (
                      <div key={category.name} className="chart-bar">
                        <div className="bar-label">
                          <span className="category-name">{category.name}</span>
                          <span className="category-count">{category.count}</span>
                        </div>
                        <div className="bar-container">
                          <div 
                            className="bar-fill category-bar" 
                            style={{ width: `${percentage}%` }}
                          ></div>
                        </div>
                        <span className="percentage">{Math.round(percentage)}%</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            
            {stats.priorities.length > 0 && (
              <div className="chart-card">
                <h3>Priorities</h3>
                <div className="chart">
                  {stats.priorities.map((priority) => {
                    const percentage = stats.total_issues > 0 ? (priority.count / stats.total_issues) * 100 : 0
                    const priorityColor = getPriorityColor(priority.name)
                    return (
                      <div key={priority.name} className="chart-bar">
                        <div className="bar-label">
                          <span className="priority-name">{priority.name}</span>
                          <span className="priority-count">{priority.count}</span>
                        </div>
                        <div className="bar-container">
                          <div 
                            className="bar-fill priority-bar" 
                            style={{ 
                              width: `${percentage}%`,
                              backgroundColor: priorityColor
                            }}
                          ></div>
                        </div>
                        <span className="percentage">{Math.round(percentage)}%</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="issues-container">
        <h2>Recent Issues</h2>
        <div className="issues-list">
          {issues.map(issue => (
            <div key={issue.id} className="issue-card">
              <div className="issue-header">
                <span className="issue-number">#{issue.number}</span>
                <span
                  className="status-badge"
                  style={{ backgroundColor: getStatusColor(issue.status) }}
                >
                  {issue.status}
                </span>
              </div>

              <h3 className="issue-title">{issue.title}</h3>

              <div className="issue-meta">
                <span className="repository">{issue.repository}</span>
                {issue.category && (
                  <span className="category-badge">{issue.category}</span>
                )}
                {issue.priority && (
                  <span
                    className="priority-badge"
                    style={{ backgroundColor: getPriorityColor(issue.priority) }}
                  >
                    {issue.priority}
                  </span>
                )}
              </div>

              {issue.tags.length > 0 && (
                <div className="tags">
                  {issue.tags.map(tag => (
                    <span key={tag} className="tag">{tag}</span>
                  ))}
                </div>
              )}

              {issue.confidence && (
                <div className="confidence">
                  Confidence: {Math.round(issue.confidence * 100)}%
                </div>
              )}

              <div className="issue-actions">
                <button
                  onClick={() => triggerClassification(issue.id)}
                  className="classify-btn"
                  disabled={issue.status === 'classified' || editingIssue?.id === issue.id}
                >
                  {issue.status === 'classified' ? 'Classified' : 'Classify'}
                </button>
                {editingIssue?.id === issue.id ? (
                  <div className="editing-controls">
                    <button
                      onClick={saveCorrection}
                      className="save-btn"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={cancelEditing}
                      className="cancel-btn"
                      disabled={isSubmitting}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => startEditing(issue)}
                    className="edit-btn"
                  >
                    Edit
                  </button>
                )}
              </div>
              
              {editingIssue?.id === issue.id && (
                <div className="editing-form">
                  <div className="form-group">
                    <label>Category:</label>
                    <select
                      value={editingIssue.category}
                      onChange={(e) => setEditingIssue({ ...editingIssue, category: e.target.value })}
                    >
                      <option value="">Select category...</option>
                      <option value="bug">Bug</option>
                      <option value="feature">Feature</option>
                      <option value="enhancement">Enhancement</option>
                      <option value="documentation">Documentation</option>
                      <option value="question">Question</option>
                      <option value="duplicate">Duplicate</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Priority:</label>
                    <select
                      value={editingIssue.priority}
                      onChange={(e) => setEditingIssue({ ...editingIssue, priority: e.target.value })}
                    >
                      <option value="">Select priority...</option>
                      <option value="critical">Critical</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Tags (comma-separated):</label>
                    <input
                      type="text"
                      value={editingIssue.tags}
                      onChange={(e) => setEditingIssue({ ...editingIssue, tags: e.target.value })}
                      placeholder="frontend, ui, urgent"
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default App
