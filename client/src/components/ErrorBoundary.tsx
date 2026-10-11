import { Component, ReactNode } from "react";
import { AlertTriangle, RotateCcw, Home } from "@/lib/icons";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorId: string | null;
}

/**
 * P0 — ErrorBoundary ภาษาไทย ไม่แสดง stack trace ใน production
 * แสดงข้อความเข้าใจง่าย + ปุ่ม "ลองใหม่" และ "กลับไปหน้าหลัก"
 */
class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorId: null };
  }

  static getDerivedStateFromError(error: Error): State {
    const errorId = `ERR-${Date.now().toString(36).toUpperCase()}`;
    // Log error to console (production: ส่งไป server/monitoring)
    console.error("[ErrorBoundary]", errorId, error);
    return { hasError: true, error, errorId };
  }

  render() {
    if (this.state.hasError) {
      const isDev = import.meta.env.DEV;
      return (
        <div className="error-boundary-overlay">
          <div className="error-boundary-card">
            <div className="error-boundary-icon">
              <AlertTriangle size={40} />
            </div>
            <h2>ระบบเกิดข้อผิดพลาดชั่วคราว</h2>
            <p>
              ข้อมูลรายการที่ยังไม่ได้บันทึกอาจไม่สมบูรณ์ กรุณาลองรีเฟรชหน้าจอ
              <br />
              หากยังพบปัญหา ให้ติดต่อผู้ดูแลระบบพร้อมแจ้งรหัสอ้างอิงด้านล่าง
            </p>
            {this.state.errorId && (
              <div className="error-boundary-ref">
                รหัสอ้างอิง: <b>{this.state.errorId}</b>
                <button
                  className="error-boundary-copy"
                  onClick={() => {
                    navigator.clipboard?.writeText(this.state.errorId ?? "");
                  }}
                  title="คัดลอกรหัสอ้างอิง"
                >
                  คัดลอก
                </button>
              </div>
            )}
            {isDev && this.state.error?.stack && (
              <details className="error-boundary-dev">
                <summary>ดูรายละเอียด technical (dev only)</summary>
                <pre>{this.state.error.stack}</pre>
              </details>
            )}
            <div className="error-boundary-actions">
              <button
                className="outline-button"
                onClick={() => {
                  this.setState({ hasError: false, error: null, errorId: null });
                  window.location.href = "/";
                }}
              >
                <Home size={16} /> กลับไปหน้าหลัก
              </button>
              <button
                className="primary-button"
                onClick={() => window.location.reload()}
              >
                <RotateCcw size={16} /> ลองใหม่
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
