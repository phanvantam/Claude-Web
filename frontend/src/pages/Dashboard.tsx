import React, { useEffect, useState } from 'react';
import {
  Card,
  Button,
  Typography,
  Empty,
  Modal,
  Form,
  Input,
  Space,
  Popconfirm,
  message,
  Row,
  Col,
  Statistic,
} from 'antd';
import {
  PlusOutlined,
  FolderOpenOutlined,
  DeleteOutlined,
  EditOutlined,
  MessageOutlined,
  ProjectOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { projectsApi } from '../services/api';
import type { Project } from '../types';

const { Title, Text, Paragraph } = Typography;

const Dashboard: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [form] = Form.useForm();
  const navigate = useNavigate();

  const loadProjects = async () => {
    try {
      setLoading(true);
      const data = await projectsApi.getAll();
      setProjects(data);
    } catch (err) {
      message.error('Không thể tải danh sách dự án');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const handleSubmit = async (values: { name: string; path: string; description?: string }) => {
    try {
      if (editingProject) {
        await projectsApi.update(editingProject.id, values);
        message.success('Cập nhật thành công');
      } else {
        await projectsApi.create(values);
        message.success('Thêm dự án thành công');
      }
      setIsModalOpen(false);
      setEditingProject(null);
      form.resetFields();
      loadProjects();
    } catch (err) {
      message.error('Có lỗi xảy ra');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await projectsApi.delete(id);
      message.success('Đã xóa dự án');
      loadProjects();
    } catch (err) {
      message.error('Không thể xóa');
    }
  };

  const handleEdit = (project: Project) => {
    setEditingProject(project);
    form.setFieldsValue(project);
    setIsModalOpen(true);
  };

  const openChat = (project: Project) => {
    navigate(`/project/${project.id}`);
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <Title level={3} style={{ color: '#fff', margin: 0 }}>
            <ProjectOutlined style={{ marginRight: 8, color: '#6c5ce7' }} />
            Dự án
          </Title>
          <Text style={{ color: 'rgba(255,255,255,0.4)' }}>
            Quản lý workspace và mở phiên chat với Claude
          </Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditingProject(null);
            form.resetFields();
            setIsModalOpen(true);
          }}
          className="primary-btn"
        >
          Thêm dự án
        </Button>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card className="stat-card">
            <Statistic
              title={<span style={{ color: 'rgba(255,255,255,0.5)' }}>Tổng dự án</span>}
              value={projects.length}
              styles={{ content: { color: '#6c5ce7' } }}
              prefix={<FolderOpenOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {projects.length === 0 && !loading ? (
        <Card className="glass-card" style={{ textAlign: 'center', padding: '48px 0' }}>
          <Empty
            description={
              <Text style={{ color: 'rgba(255,255,255,0.4)' }}>
                Chưa có dự án nào. Hãy thêm dự án đầu tiên!
              </Text>
            }
          >
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setIsModalOpen(true)}
              className="primary-btn"
            >
              Thêm dự án
            </Button>
          </Empty>
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {projects.map((project) => (
            <Col xs={24} sm={12} lg={8} key={project.id}>
              <Card
                className="project-card"
                hoverable
                actions={[
                  <Button
                    type="text"
                    icon={<MessageOutlined />}
                    onClick={() => openChat(project)}
                    style={{ color: '#6c5ce7' }}
                  >
                    Chat
                  </Button>,
                  <Button
                    type="text"
                    icon={<EditOutlined />}
                    onClick={() => handleEdit(project)}
                    style={{ color: '#ffa940' }}
                  />,
                  <Popconfirm
                    title="Xóa dự án này?"
                    onConfirm={() => handleDelete(project.id)}
                    okText="Xóa"
                    cancelText="Hủy"
                  >
                    <Button
                      type="text"
                      icon={<DeleteOutlined />}
                      danger
                    />
                  </Popconfirm>,
                ]}
              >
                <Card.Meta
                  title={
                    <Text style={{ color: '#fff', fontSize: 16 }}>{project.name}</Text>
                  }
                  description={
                    <>
                      <div className="project-path">
                        <FolderOpenOutlined style={{ marginRight: 4 }} />
                        {project.path}
                      </div>
                      {project.description && (
                        <Paragraph
                          style={{ color: 'rgba(255,255,255,0.5)', marginBottom: 0, marginTop: 8 }}
                          ellipsis={{ rows: 2 }}
                        >
                          {project.description}
                        </Paragraph>
                      )}
                    </>
                  }
                />
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Modal
        title={editingProject ? 'Sửa dự án' : 'Thêm dự án mới'}
        open={isModalOpen}
        onCancel={() => {
          setIsModalOpen(false);
          setEditingProject(null);
          form.resetFields();
        }}
        footer={null}
        className="dark-modal"
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label="Tên dự án"
            rules={[{ required: true, message: 'Vui lòng nhập tên dự án' }]}
          >
            <Input placeholder="e.g. My Web App" />
          </Form.Item>
          <Form.Item
            name="path"
            label="Đường dẫn thư mục"
            rules={[{ required: true, message: 'Vui lòng nhập đường dẫn' }]}
          >
            <Input placeholder="e.g. /Users/user/projects/my-app" />
          </Form.Item>
          <Form.Item name="description" label="Mô tả">
            <Input.TextArea rows={3} placeholder="Mô tả ngắn về project..." />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" className="primary-btn">
                {editingProject ? 'Cập nhật' : 'Thêm'}
              </Button>
              <Button onClick={() => setIsModalOpen(false)}>Hủy</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default Dashboard;
