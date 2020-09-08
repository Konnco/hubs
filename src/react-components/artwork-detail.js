import React, { Component } from "react";
import "../assets/stylesheets/artwork-detail.scss";

export default class ArtworkDetail extends Component {
  static propTypes = {};
  constructor(props) {
    super(props);

    this.updateData = this.updateData.bind(this);
    this.closeHandler = this.closeHandler.bind(this);
    this.openLinkHandler = this.openLinkHandler.bind(this);
  }

  componentDidMount() {
    window.addEventListener("view-artwork", this.updateData);
  }

  componentWillUnmount() {
    window.removeEventListener("view-artwork", this.updateData);
  }

  updateData(data) {
    const parsedJson = JSON.parse(data.detail);
    this.setState({ ...parsedJson, show: true });
  }

  closeHandler() {
    this.setState({ show: false });
  }

  formatSize(value) {
    return (Math.round(value * 10) / 10) * 10;
  }

  openLinkHandler() {
    window.open(this.state.url, "_blank");
  }

  state = {};

  render() {
    return (
      <div className="detail-artworks" data-is-show={this.state.show}>
        <div className="detail-artworks__container">
          <div className="detail-artworks__image-container">
            <div className="detail-artworks__close" onClick={this.closeHandler}>
              X
            </div>
            <img src={this.state.src} className="detail-artworks__image-src" />
          </div>
          <div className="detail-artworks__title">{this.state.title}</div>
          <div className="detail-artworks__artist">By {this.state.artist}</div>
          <div className="detail-artworks__divider" />
          <div className="detail-artworks__tags">
            <div className="detail-artworks__tags-label">Medium</div>
            <div className="detail-artworks__tags-value">{this.state.medium}</div>
          </div>
          <div className="detail-artworks__tags">
            <div className="detail-artworks__tags-label">Dimension</div>
            <div className="detail-artworks__tags-value">
              {this.formatSize(this.state.width)} x {this.formatSize(this.state.height)} cm
            </div>
          </div>
          <div className="detail-artworks__tags">
            <div className="detail-artworks__tags-label">Year Of Artwork</div>
            <div className="detail-artworks__tags-value">{this.state.year}</div>
          </div>
          <div className="detail-artworks__divider" />
          <p className="detail-artworks__description">{this.state.description}</p>
          <button onClick={this.openLinkHandler} className="detail-artworks__link">
            Open Link
          </button>
        </div>
      </div>
    );
  }
}
