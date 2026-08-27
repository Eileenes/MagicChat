package mobilepush

import (
	"context"
	"time"

	"app/internal/store"

	"gorm.io/gorm"
)

type QueueMetrics struct {
	Enabled                      bool
	EventCounts                  map[string]int64
	GrantCounts                  map[string]int64
	JobCounts                    map[string]int64
	OldestPendingEventAgeSeconds float64
	OldestPendingJobAgeSeconds   float64
}

type queueStatusCount struct {
	Status string
	Count  int64
}

func (s *Service) QueueMetrics(ctx context.Context) (QueueMetrics, error) {
	metrics := QueueMetrics{
		Enabled:     s.enabled,
		EventCounts: make(map[string]int64),
		GrantCounts: make(map[string]int64),
		JobCounts:   make(map[string]int64),
	}
	if err := collectStatusCounts(
		s.db.WithContext(ctx).Model(&store.MobilePushEvent{}),
		metrics.EventCounts,
	); err != nil {
		return QueueMetrics{}, err
	}
	if err := collectStatusCounts(
		s.db.WithContext(ctx).Model(&store.MobilePushJob{}),
		metrics.JobCounts,
	); err != nil {
		return QueueMetrics{}, err
	}
	if err := collectStatusCounts(
		s.db.WithContext(ctx).Model(&store.UserPushGrant{}),
		metrics.GrantCounts,
	); err != nil {
		return QueueMetrics{}, err
	}
	now := s.now().UTC()
	eventAge, err := oldestQueueAge(
		s.db.WithContext(ctx).Model(&store.MobilePushEvent{}).
			Where("status IN ?", []string{EventStatusQueued, EventStatusRetry, EventStatusExpanding}),
		now,
	)
	if err != nil {
		return QueueMetrics{}, err
	}
	jobAge, err := oldestQueueAge(
		s.db.WithContext(ctx).Model(&store.MobilePushJob{}).
			Where("status IN ?", []string{JobStatusQueued, JobStatusRetry, JobStatusSending}),
		now,
	)
	if err != nil {
		return QueueMetrics{}, err
	}
	metrics.OldestPendingEventAgeSeconds = eventAge
	metrics.OldestPendingJobAgeSeconds = jobAge
	return metrics, nil
}

func collectStatusCounts(query *gorm.DB, destination map[string]int64) error {
	var counts []queueStatusCount
	if err := query.Select("status, count(*) AS count").Group("status").Scan(&counts).Error; err != nil {
		return err
	}
	for _, count := range counts {
		destination[count.Status] = count.Count
	}
	return nil
}

func oldestQueueAge(query *gorm.DB, now time.Time) (float64, error) {
	var oldest struct {
		CreatedAt time.Time
	}
	result := query.Select("created_at").Order("created_at ASC").Limit(1).Scan(&oldest)
	if result.Error != nil {
		return 0, result.Error
	}
	if result.RowsAffected == 0 || !oldest.CreatedAt.Before(now) {
		return 0, nil
	}
	return now.Sub(oldest.CreatedAt).Seconds(), nil
}
