package httpapi

import (
	"encoding/json"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"zhiwellcare/backend/internal/model"
	"zhiwellcare/backend/internal/store"
)

// ---------- 训练摘要上报（APP 登录后） ----------

type recordHandler struct{ store store.Combined }

type submitRecordRequest struct {
	RecordID      string          `json:"recordId"`
	SchemaVersion int             `json:"schemaVersion"`
	GameID        string          `json:"gameId"`
	GameName      string          `json:"gameName"`
	CompletedAt   int64           `json:"completedAt"` // epoch ms
	Device        struct {
		ModelID        string   `json:"modelId"`
		ModelName      string   `json:"modelName"`
		CapabilityTags []string `json:"capabilityTags"`
	} `json:"device"`
	Statistics    json.RawMessage `json:"statistics"`
	ClientVersion string          `json:"clientVersion"`
}

// submit POST /api/v1/training/records（登录用户）
func (h *recordHandler) submit(c *gin.Context) {
	var req submitRecordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		failBadRequest(c, "请求参数格式不正确")
		return
	}
	if req.RecordID == "" || req.GameID == "" || req.CompletedAt <= 0 {
		failBadRequest(c, "recordId / gameId / completedAt 为必填")
		return
	}
	stats := req.Statistics
	if len(stats) == 0 {
		stats = json.RawMessage(`{}`)
	}
	userID, _ := c.Get(ctxUserID)
	userIDStr := userID.(string)
	record := model.TrainingSummary{
		RecordID:        req.RecordID,
		UserID:          &userIDStr,
		GameID:          req.GameID,
		GameName:        req.GameName,
		DeviceModelID:   req.Device.ModelID,
		DeviceModelName: req.Device.ModelName,
		CapabilityTags:  req.Device.CapabilityTags,
		Statistics:      stats,
		ClientVersion:   req.ClientVersion,
		CompletedAt:     time.UnixMilli(req.CompletedAt),
	}
	if err := h.store.SaveTrainingRecord(c, record); err != nil {
		mapStoreError(c, err)
		return
	}
	ok(c, gin.H{"accepted": true})
}

// ---------- 后台查询 ----------

type recordsListResponse struct {
	Items []model.TrainingSummary `json:"items"`
	Total int64                   `json:"total"`
}

func (h *recordHandler) adminList(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
	items, total, err := h.store.ListTrainingRecords(c, store.TrainingRecordFilter{
		UserID:   c.Query("userId"),
		GameID:   c.Query("gameId"),
		ModelID:  c.Query("modelId"),
		Page:     page,
		PageSize: size,
	})
	if err != nil {
		mapStoreError(c, err)
		return
	}
	ok(c, recordsListResponse{Items: items, Total: total})
}

// myRecords GET /api/v1/me/training-records（APP 个人云端记录）
func (h *recordHandler) myRecords(c *gin.Context) {
	userID, _ := c.Get(ctxUserID)
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
	items, total, err := h.store.ListTrainingRecords(c, store.TrainingRecordFilter{
		UserID:   userID.(string),
		Page:     page,
		PageSize: size,
	})
	if err != nil {
		mapStoreError(c, err)
		return
	}
	ok(c, recordsListResponse{Items: items, Total: total})
}
