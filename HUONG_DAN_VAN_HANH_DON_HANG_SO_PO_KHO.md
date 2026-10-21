# HƯỚNG DẪN VẬN HÀNH ĐƠN HÀNG BÁN (SO), PHÂN TÍCH TỒN KHO & MUA HÀNG NHÀ CUNG CẤP (PR/PO)

## I. TỔNG QUAN HỆ THỐNG VẬN HÀNH ĐƠN HÀNG (SALES ORDERS)
Hệ thống vận hành đơn hàng kinh doanh (Sales Orders) được chuẩn hóa theo mô hình chuỗi cung ứng thương mại hiện đại:
- **Liên kết 3 bộ phận**: Kinh doanh (Sales) ➔ Mua hàng / Cung ứng (Procurement) ➔ Kho vận & Giao nhận (Warehouse & Logistics).
- **Loại bỏ quy trình sản xuất (DHX) đối với hàng thương mại**: Mọi mặt hàng thiếu tồn kho sẽ được chuyển trực tiếp thành **Yêu cầu mua hàng (PR - Purchase Request)** gửi sang Nhà cung cấp thông qua **Đơn đặt hàng nhà cung cấp (PO - Purchase Order)**.
- **Tự động hóa phân tích tồn kho khả dụng (Available Stock)** theo thời gian thực.

---

## II. CƠ CHẾ PHÂN TÍCH TỒN KHO & ĐẶT MUA NHÀ CUNG CẤP (REAL-TIME STOCK ENGINE)
Để tránh tình trạng bán vượt tồn kho (overselling) hoặc mua thừa trùng lặp (duplicate procurement), hệ thống sử dụng thuật toán tính toán động:

### 1. Công thức Tồn kho Khả dụng (Available Stock)
$$\text{Tồn Khả Dụng (Món X)} = \max\Big(0, \text{Tổng Tồn Thực Tế Tại Kho} - \sum \text{Số Lượng Giữ Chỗ Bởi Các Đơn Khác Chưa Giao}\Big)$$

- Đơn hàng tạo trước (theo thứ tự thời gian) sẽ được ưu tiên giữ chỗ tồn kho trước.
- Đơn hàng tạo sau chỉ được sử dụng phần tồn kho còn dư lại sau khi đã khấu trừ các đơn trước.

### 2. Công thức Hàng Sắp Về (Incoming POs)
$$\text{Hàng Sắp Về (Món X)} = \sum \text{Số Lượng Trên Các Đơn PO Nhà Cung Cấp Đang Mua/Đang Vận Chuyển Chưa Nhập Kho}$$

- Hệ thống quét tự động toàn bộ các PO ở trạng thái `ORDERED`, `Shipped`, `IN_TRANSIT` liên kết với mặt hàng đó.

### 3. Phân loại tình trạng từng dòng sản phẩm (Line-Item Status)
Mỗi sản phẩm trong đơn hàng sẽ được hệ thống phân loại thành 1 trong 4 trạng thái trực quan:
1. **`[🟢 Có sẵn: Đủ hàng]`**: $\text{Tồn khả dụng} \ge \text{Số lượng cần giao còn lại}$. Đủ hàng trong kho để xuất giao ngay.
2. **`[🚚 Hàng sắp về - Chờ giao]`**: $\text{Tồn khả dụng} + \text{Hàng sắp về (PO)} \ge \text{Số lượng cần giao còn lại}$. Hàng đã được đặt mua NCC và đang trên đường về kho, không cần đặt mua lại.
3. **`[🟡 Cần đặt mua NCC]`**: $\text{Tồn khả dụng} + \text{Hàng sắp về (PO)} < \text{Số lượng cần giao còn lại}$.
   $$\text{Số Lượng Thiếu Cần Mua} = \text{Số Lượng Còn Lại} - \text{Tồn Khả Dụng} - \text{Hàng Sắp Về}$$
4. **`[✓ Đã giao đủ]`**: Số lượng cần giao còn lại $= 0$ (mặt hàng đã xuất giao hoàn tất).

---

## III. HỆ THỐNG TRẠNG THÁI ĐƠN HÀNG (ORDER STATUS BADGES) & NÚT THAO TÁC
Tại bảng danh sách đơn hàng, cột **Trạng thái chung** tự động tính toán tổng hợp từ tình trạng của tất cả các dòng sản phẩm trong đơn:

| Trạng Thái Hiển Thị | Màu Sắc | Ý Nghĩa Vận Hành | Nút Thao Tác Kích Hoạt |
| :--- | :---: | :--- | :--- |
| **`🟢 Sẵn sàng giao hàng`** | Xanh lá | Toàn bộ các món trong đơn đều có sẵn đủ trong kho 100%. | **`[📦 Giao đủ hàng (Sẵn sàng)]`** |
| **`🟡 Cần đặt mua 1 phần`** | Vàng cam | Đơn có một số món có sẵn đủ/một phần, các món còn lại bị thiếu trong kho. | **`[📦 Giao trước 1 phần]`**<br>**`[🛒 Tạo PR mua NCC]`** |
| **`🟡 Cần đặt mua`** | Vàng cam | Toàn bộ các món trong đơn đều hết hàng trong kho. | **`[🛒 Tạo PR mua NCC]`** |
| **`🚚 Đang mua hàng`** | Xanh dương | Các món thiếu đã được lập đơn mua hàng PO gửi Nhà cung cấp. | **`[👁️ Chi tiết]`** |
| **`🚚 Đang mua hàng (Có sẵn 1 phần)`** | Xanh dương | Đã có PO cho phần thiếu, đồng thời trong kho có sẵn 1 phần có thể xuất giao trước. | **`[📦 Giao trước 1 phần]`**<br>**`[👁️ Chi tiết]`** |
| **`⏳ Đã gửi PR (Chờ PO)`** | Vàng hổ phách | Kinh doanh đã gửi đề nghị mua hàng (PR), đang chờ phòng Cung ứng phát hành PO. | **`[👁️ Chi tiết]`** |
| **`📦 Đã giao một phần`** | Tím | Đơn hàng đã xuất giao đợt 1 (hoặc đợt n), đang tiếp tục chờ đợt hàng tiếp theo. | **`[📦 Xuất giao tiếp]`**<br>(khi có hàng mới về) |
| **`✓ Đã giao hoàn tất`** | Xanh ngọc | Đơn hàng đã xuất giao đủ 100% số lượng cho khách. | **`[👁️ Xem phiếu xuất]`** |

---

## IV. QUY TRÌNH THAO TÁC CHI TIẾT

### 1. Quy Trình Xuất Hàng Giao Đủ 100% (Full Delivery)
- **Áp dụng khi**: Đơn có trạng thái `🟢 Sẵn sàng giao hàng`.
- **Thao tác**:
  1. Bấm nút **`[📦 Giao đủ hàng (Sẵn sàng)]`** ở dòng đơn hàng.
  2. Modal xác nhận giao hàng xuất hiện, hiển thị danh sách sản phẩm và số lượng xuất đầy đủ 100%.
  3. Chọn kho xuất hàng, phương thức vận chuyển và người giao.
  4. Bấm **`[Xác Nhận Xuất Kho & Bàn Giao]`**.
  5. Đơn hàng chuyển sang trạng thái `✓ Đã giao hoàn tất`, hệ thống tự động trừ kho và sinh mã Phiếu giao hàng (Delivery Slip).

### 2. Quy Trình Thao Tác "Giao Trước 1 Phần" (Partial Delivery)
- **Áp dụng khi**: Đơn có trạng thái `🟡 Cần đặt mua 1 phần` hoặc `🚚 Đang mua hàng (Có sẵn 1 phần)`. Khách hàng cần gấp các món đang có sẵn trong kho, không muốn chờ đến khi toàn bộ đơn hàng đủ mới giao.
- **Thao tác**:
  1. Bấm nút **`[📦 Giao trước 1 phần]`** tại dòng đơn hàng.
  2. Modal xuất hàng mở ra ở chế độ `PARTIAL`:
     - **Món có sẵn trong kho**: Tự động điền số lượng xuất = Số lượng khả dụng tối đa trong kho.
     - **Món bị thiếu**: Tự động điền số lượng xuất = `0`.
  3. Nhân viên có thể linh hoạt điều chỉnh số lượng xuất thực tế nếu muốn giao ít hơn số tồn.
  4. Bấm **`[Xác Nhận Xuất Kho Đợt Này]`**.
  5. **Kết quả**:
     - Đơn hàng chuyển trạng thái thành `📦 Đã giao một phần`.
     - Hệ thống lưu lại lịch sử chi tiết đợt giao số 1 (mã phiếu, ngày giao, người nhận, số lượng từng món).
     - Số lượng cần giao còn lại của đơn tự động giảm trừ tương ứng.

### 3. Quy Trình Tạo Đề Nghị Mua Hàng Nhà Cung Cấp (PR - Purchase Request)
- **Áp dụng khi**: Đơn có món bị thiếu cần mua NCC (`🟡 Cần đặt mua 1 phần` hoặc `🟡 Cần đặt mua`).
- **Thao tác**:
  1. Bấm nút **`[🛒 Tạo PR mua NCC]`** tại dòng đơn hàng hoặc trong modal Chi tiết đơn.
  2. Modal lập Phiếu Yêu Cầu Mua Hàng (PR) xuất hiện:
     - Hệ thống hiển thị bảng phân tích 4 cột:
       - **Số lượng Đơn Khách (SO Qty)**
       - **Tồn Khả Dụng Trong Kho (Avail Stock)**
       - **Hàng Sắp Về (Incoming POs)**
       - **Số Lượng Cần Mua Đề Xuất (PR Qty)**
     - Số lượng đề xuất mua được tính tự động: $\text{Cần Mua} = \max(0, \text{Đơn Khách} - \text{Tồn Khả Dụng} - \text{Hàng Sắp Về})$.
  3. Nhân viên kiểm tra, có thể điều chỉnh ghi chú hoặc làm tròn số lượng (ví dụ mua theo thùng/hộp).
  4. Chọn Nhà cung cấp đề xuất và ngày mong muốn nhận hàng.
  5. Bấm **`[Gửi Đề Nghị Mua Hàng (PR)]`**.
  6. **Kết quả**:
     - Phiếu PR được sinh ra và gửi thẳng sang phân hệ **Cung ứng & Mua hàng (Procurement)**.
     - Đơn hàng chuyển trạng thái `⏳ Đã gửi PR (Chờ PO)` hoặc `🚚 Đang mua hàng`.
     - Khi phòng Mua hàng duyệt PR và phát hành PO gửi Nhà cung cấp, thông tin mã PO và ngày về dự kiến sẽ tự động hiển thị ngược lại trong modal Chi tiết đơn hàng của Kinh doanh.

---

## V. MODAL CHI TIẾT ĐƠN HÀNG THÍCH ỨNG (ADAPTIVE STEPPER)
Khi bấm nút **`[👁️ Chi tiết]`** tại bất kỳ đơn hàng nào, modal chi tiết sẽ tự động nhận diện tính chất đơn hàng và hiển thị sơ đồ luồng tiến độ (Stepper) tương ứng:

1. **Luồng Đơn Hàng Có Sẵn Đủ (3 Chặng)**:
   $$\text{[1. Đặt Hàng SO]} \longrightarrow \text{[2. Xuất Kho Giao Hàng]} \longrightarrow \text{[3. Bàn Giao Khách Hoàn Tất]}$$

2. **Luồng Đơn Hàng Giao Từng Phần (4 Chặng)**:
   $$\text{[1. Đặt Hàng SO]} \longrightarrow \text{[2. Giao Đợt 1 (Hàng sẵn)]} \longrightarrow \text{[3. Nhập Kho Phần Thiếu]} \longrightarrow \text{[4. Giao Hoàn Tất Đợt 2]}$$

3. **Luồng Đơn Hàng Mua Mới Toàn Bộ (5 Chặng)**:
   $$\text{[1. Đặt Hàng SO]} \longrightarrow \text{[2. Tạo Đề Nghị Mua PR]} \longrightarrow \text{[3. Phát Hành PO Cho NCC]} \longrightarrow \text{[4. Nhập Kho NCC]} \longrightarrow \text{[5. Xuất Giao Khách]}$$

Ngoài ra, bảng danh sách sản phẩm trong modal hiển thị:
- **Badge trạng thái kho** của từng món (`Có sẵn`, `Sắp về`, `Cần mua`).
- **Badge thông tin PO liên kết**: Hiển thị Nhà cung cấp, mã PO, ngày dự kiến giao và tiến độ vận chuyển thực tế từ NCC.
