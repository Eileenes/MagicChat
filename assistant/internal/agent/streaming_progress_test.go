package agent

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"assistant/internal/llm"
	"assistant/internal/mcpclient"
)

type streamingPhaseModel struct {
	createCalls int
	streamCalls int
	stream      func(context.Context, llm.Request, func(llm.StreamEvent) error) (llm.Response, error)
	create      func(context.Context, llm.Request) (llm.Response, error)
}

func (m *streamingPhaseModel) CreateMessage(ctx context.Context, req llm.Request) (llm.Response, error) {
	m.createCalls++
	if m.create != nil {
		return m.create(ctx, req)
	}
	return llm.Response{}, errors.New("CreateMessage must not be called")
}
func (m *streamingPhaseModel) StreamMessage(ctx context.Context, req llm.Request, observe func(llm.StreamEvent) error) (llm.Response, error) {
	m.streamCalls++
	return m.stream(ctx, req, observe)
}

func runPhaseSession(t *testing.T, a *Agent, observer ProgressObserver, outputs *[]string) error {
	t.Helper()
	s, err := a.NewSession(Request{Content: "test"})
	if err != nil {
		t.Fatal(err)
	}
	return s.RunCycleWithProgress(context.Background(), sinkFunc(func(_ context.Context, text string) error {
		*outputs = append(*outputs, text)
		return nil
	}), observer)
}

func TestRunCycleWithProgressPrefersStreamingAndReportsBlockPhases(t *testing.T) {
	var phases []Phase
	firstCallbackSawThinking := false
	m := &streamingPhaseModel{stream: func(_ context.Context, _ llm.Request, observe func(llm.StreamEvent) error) (llm.Response, error) {
		firstCallbackSawThinking = reflect.DeepEqual(phases, []Phase{PhaseThinking})
		for _, typ := range []string{llm.BlockTypeThinking, llm.BlockTypeToolUse, llm.BlockTypeText} {
			if err := observe(llm.StreamEvent{Type: llm.StreamEventBlockStart, BlockType: typ}); err != nil {
				t.Fatal(err)
			}
		}
		return llm.Response{Blocks: []llm.Block{{Type: llm.BlockTypeText, Text: "done"}}}, nil
	}}
	var outputs []string
	if err := runPhaseSession(t, New(m), func(p Phase) { phases = append(phases, p) }, &outputs); err != nil {
		t.Fatal(err)
	}
	if m.streamCalls != 1 || m.createCalls != 0 {
		t.Fatalf("stream=%d create=%d", m.streamCalls, m.createCalls)
	}
	if !firstCallbackSawThinking {
		t.Fatalf("phases before first stream event = %v", phases)
	}
	want := []Phase{PhaseThinking, PhaseThinking, PhaseTool, PhaseText}
	if !reflect.DeepEqual(phases, want) {
		t.Fatalf("phases=%v want=%v", phases, want)
	}
}

type phaseToolRegistry struct {
	phases      *[]Phase
	phaseAtCall Phase
}

func (r *phaseToolRegistry) Tools() []mcpclient.Tool { return []mcpclient.Tool{{Name: "test__tool"}} }
func (r *phaseToolRegistry) CallTool(context.Context, string, json.RawMessage) (mcpclient.ToolResult, error) {
	if len(*r.phases) > 0 {
		r.phaseAtCall = (*r.phases)[len(*r.phases)-1]
	}
	return mcpclient.ToolResult{Content: `{"ok":true}`}, nil
}

func TestRunCycleWithProgressMixedResponseReturnsToToolAndNextTurnThinking(t *testing.T) {
	var phases []Phase
	calls := 0
	m := &streamingPhaseModel{stream: func(_ context.Context, _ llm.Request, observe func(llm.StreamEvent) error) (llm.Response, error) {
		calls++
		if calls == 1 {
			_ = observe(llm.StreamEvent{Type: llm.StreamEventBlockStart, BlockType: llm.BlockTypeText})
			_ = observe(llm.StreamEvent{Type: llm.StreamEventBlockStart, BlockType: llm.BlockTypeToolUse})
			_ = observe(llm.StreamEvent{Type: llm.StreamEventBlockStart, BlockType: llm.BlockTypeText})
			return llm.Response{Blocks: []llm.Block{{Type: llm.BlockTypeText, Text: "before"}, {Type: llm.BlockTypeToolUse, ToolUseID: "u1", ToolName: "test__tool", ToolInput: []byte(`{}`)}}}, nil
		}
		_ = observe(llm.StreamEvent{Type: llm.StreamEventBlockStart, BlockType: llm.BlockTypeText})
		return llm.Response{Blocks: []llm.Block{{Type: llm.BlockTypeText, Text: "after"}}}, nil
	}}
	r := &phaseToolRegistry{phases: &phases}
	var outputs []string
	if err := runPhaseSession(t, New(m, WithToolRegistry(r)), func(p Phase) { phases = append(phases, p) }, &outputs); err != nil {
		t.Fatal(err)
	}
	if r.phaseAtCall != PhaseTool {
		t.Fatalf("phase at CallTool=%q", r.phaseAtCall)
	}
	// The forced tool transition is followed by thinking before the second request.
	found := false
	for i := 0; i+1 < len(phases); i++ {
		if phases[i] == PhaseTool && phases[i+1] == PhaseThinking {
			found = true
		}
	}
	if !found {
		t.Fatalf("no tool->thinking transition: %v", phases)
	}
}

func TestRunCycleWithProgressNonStreamingFallbackReportsPhases(t *testing.T) {
	calls := 0
	model := modelFunc(func(context.Context, llm.Request) (llm.Response, error) {
		calls++
		return llm.Response{Blocks: []llm.Block{{Type: llm.BlockTypeText, Text: "done"}}}, nil
	})
	var phases []Phase
	var outputs []string
	if err := runPhaseSession(t, New(model), func(p Phase) { phases = append(phases, p) }, &outputs); err != nil {
		t.Fatal(err)
	}
	if calls != 1 || !reflect.DeepEqual(phases, []Phase{PhaseThinking, PhaseText}) {
		t.Fatalf("calls=%d phases=%v", calls, phases)
	}
}

func TestRunCycleWithProgressStreamingErrorFallbackAndCancelNoOutput(t *testing.T) {
	for _, tc := range []struct {
		name        string
		err         error
		wantOutputs []string
	}{{"error", errors.New("stream failed"), []string{ModelErrorFallback}}, {"cancel", context.Canceled, nil}} {
		t.Run(tc.name, func(t *testing.T) {
			m := &streamingPhaseModel{stream: func(context.Context, llm.Request, func(llm.StreamEvent) error) (llm.Response, error) {
				return llm.Response{}, tc.err
			}}
			var outputs []string
			err := runPhaseSession(t, New(m), nil, &outputs)
			if !errors.Is(err, tc.err) {
				t.Fatalf("error=%v want=%v", err, tc.err)
			}
			if !reflect.DeepEqual(outputs, tc.wantOutputs) {
				t.Fatalf("outputs=%v want=%v", outputs, tc.wantOutputs)
			}
		})
	}
}

func TestRunCycleFallsBackWhenStreamingUnsupported(t *testing.T) {
	var phases []Phase
	m := &streamingPhaseModel{
		stream: func(context.Context, llm.Request, func(llm.StreamEvent) error) (llm.Response, error) {
			return llm.Response{}, llm.ErrStreamingUnsupported
		},
		create: func(context.Context, llm.Request) (llm.Response, error) {
			return llm.Response{Blocks: []llm.Block{{Type: llm.BlockTypeText, Text: "fallback answer"}}}, nil
		},
	}
	var outputs []string
	err := runPhaseSession(t, New(m), func(p Phase) { phases = append(phases, p) }, &outputs)
	if err != nil {
		t.Fatal(err)
	}
	if m.streamCalls != 1 || m.createCalls != 1 {
		t.Fatalf("stream/create calls = %d/%d", m.streamCalls, m.createCalls)
	}
	if !reflect.DeepEqual(outputs, []string{"fallback answer"}) {
		t.Fatalf("outputs = %#v", outputs)
	}
	if !reflect.DeepEqual(phases, []Phase{PhaseThinking, PhaseText}) {
		t.Fatalf("phases = %#v", phases)
	}
}
